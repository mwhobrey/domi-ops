import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:https";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { createBetterAuth, MCP_POLICY_VERSION } from "@domi-ops/auth";
import { envSchema, mcpSupportedScopes, type Env } from "@domi-ops/config";
import { createDb, closeDb, householdMembers, households, users, householdSubscriptions, shoppingItems,
  mcpConnections, mcpWriteIntents, mcpWriteEvents, mcpClientProfiles, oauthClient,
  withSystemContext, withUserLookupContext, withHouseholdContext, withMcpProviderContext, type Database } from "@domi-ops/db";
import { mcpAuthorizationRoutes } from "./mcp-authorization.js";
import { mcpWriteRoutes } from "./mcp-writes.js";
import { reviewedWrites, ReviewedWriteError, canonicalWriteJson, type ReviewedOperation } from "../mcp/reviewed-writes.js";

const url=process.env.MCP_TEST_DATABASE_URL??process.env.HOSTED_TEST_DATABASE_URL;
const suite=url?describe:describe.skip;
type Person={userId:string;memberId:string;householdId:string;headers:Headers;email:string};
type Change={intentId:string;state:string;expiresAt:string;receiptId:string|null;reviewUrl?:string;nonce?:string;digest?:string;preview?:unknown};
const scopes=["shopping:read","chores:read","shopping:write","chores:write","offline_access"];

for(const mode of ["single","shared"] as const)suite(`Reviewed MCP writes (${mode}, restricted role)`,()=>{
  let db:Database,auth:ReturnType<typeof createBetterAuth>,env:Env,server:ReturnType<typeof serve>,origin:string,clientId:string;
  let owner:Person,peer:Person,stranger:Person,child:Person;
  let failApply=false,timeoutApply=false;
  let beforeApply:(()=>Promise<void>)|null=null;
  const householdIds:string[]=[],userIds:string[]=[],clientIds:string[]=[];
  const callback="https://synthetic-assistant.example.test/review",verifier="w".repeat(64);
  const challenge=createHash("sha256").update(verifier).digest("base64url");
  const adapter:ReviewedOperation={name:"synthetic.rename",version:"1",scope:"shopping:write",roles:["owner","admin","member"],
    input:z.object({recordId:z.string().uuid(),item:z.string().min(1).max(256)}).strict(),
    async snapshot(tx,identity,input){
      const [row]=await tx.select().from(shoppingItems).where(and(eq(shoppingItems.id,input.recordId as string),eq(shoppingItems.householdId,identity.householdId)));
      if(!row)throw new ReviewedWriteError("change_unavailable",404);
      return{title:"Rename a fictional shopping item",targets:[{kind:"shopping",id:row.id,revision:row.revision}],changes:[{field:"Item",before:row.item,after:input.item as string}]};
    },
    async authorize(tx,identity,targets){
      for(const target of targets){const [row]=await tx.select().from(shoppingItems).where(and(eq(shoppingItems.id,target.id),eq(shoppingItems.householdId,identity.householdId)));
        // A fictional adapter-only sharing rule; no production operation is installed.
        if(!row||row.createdByDisplayName!==identity.userId)throw new ReviewedWriteError("change_unavailable",404);}
    },
    async apply(tx,identity,input){
      if(beforeApply)await beforeApply();
      await tx.update(shoppingItems).set({item:input.item as string}).where(and(eq(shoppingItems.id,input.recordId as string),eq(shoppingItems.householdId,identity.householdId)));
      if(timeoutApply)await tx.execute(sql`select pg_sleep(2)`);
      if(failApply)throw new Error("synthetic adapter failure");
    },
  };
  async function owned<T>(person:Person,fn:(tx:Database)=>Promise<T>){return withUserLookupContext(db,person.userId,lookup=>withHouseholdContext(lookup,person.householdId,fn));}
  async function post(path:string,body:unknown,person=owner,token?:string,extra:Record<string,string>={}){
    const headers=token?new Headers({authorization:"Bearer "+token,"content-type":"application/json"}):new Headers(person.headers);
    Object.entries(extra).forEach(([key,value])=>headers.set(key,value));
    return fetch(origin+path,{method:"POST",headers,body:JSON.stringify(body)});
  }
  async function register(){const value=await auth.mcp.registerClient(owner.headers,{name:"Fictional reviewed writes",redirectUris:[callback],tokenEndpointAuthMethod:"none",scopes,provider:"local",profileVersion:"writes.fixture.v1",dataMode:"synthetic",enabled:true});clientIds.push(value.client_id);return value.client_id;}
  async function connect(person=owner,requested=scopes,client=clientId){
    const query=new URLSearchParams({response_type:"code",client_id:client,redirect_uri:callback,scope:requested.join(" "),resource:origin+"/api/mcp",state:randomUUID(),code_challenge:challenge,code_challenge_method:"S256"});
    const start=await fetch(origin+"/auth/oauth2/authorize?"+query,{headers:person.headers,redirect:"manual"});
    const location=start.headers.get("location")??(await start.json() as {url:string}).url;
    const oauthQuery=new URL(location,origin).searchParams.toString();
    const pending=await auth.mcp.prepareConsent(person.headers,{householdId:person.householdId,oauthQuery,noteIds:[],adultAttested:true,privacyAttested:true,providerSettingsReviewed:true,policyVersion:MCP_POLICY_VERSION});
    const decided=await auth.mcp.decideConsent(person.headers,{pendingId:pending.pendingId,oauthQuery,accept:true});
    if(!decided.accepted)throw new Error("fictional consent denied");
    const code=new URL(decided.redirectUri).searchParams.get("code")!;
    const response=await fetch(origin+"/auth/oauth2/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"authorization_code",client_id:client,redirect_uri:callback,code,code_verifier:verifier,resource:origin+"/api/mcp"})});
    expect(response.status).toBe(200);return{...await response.json() as {access_token:string;refresh_token:string},connectionId:decided.connectionId};
  }
  async function fixture(){
    const id=randomUUID();await owned(owner,tx=>tx.insert(shoppingItems).values({id,householdId:owner.householdId,item:"Before",createdByDisplayName:owner.userId}));
    const token=await connect();
    const prepare=async(item="After",key=randomUUID())=>{const response=await post("/api/mcp-writes/prepare",{operation:adapter.name,payload:{recordId:id,item},idempotencyKey:key},owner,token.access_token);expect(response.status,await response.clone().text()).toBe(200);return await response.json() as Change;};
    const change=await prepare();
    const review=async()=>{const r=await post("/api/mcp-writes/browser/"+token.connectionId+"/review",{intentId:change.intentId});expect(r.status,await r.clone().text()).toBe(200);return await r.json() as Change;};
    const confirm=(view:Change,person=owner,extra={})=>post("/api/mcp-writes/browser/"+token.connectionId+"/confirm",{intentId:change.intentId,digest:view.digest,nonce:view.nonce,...extra},person);
    const read=async()=>{const [row]=await owned(owner,tx=>tx.select().from(shoppingItems).where(eq(shoppingItems.id,id)));return row;};
    return{id,token,prepare,change,review,confirm,read};
  }
  beforeAll(async()=>{
    db=createDb(url!);const [role]=await db.execute<{rolsuper:boolean;rolbypassrls:boolean}>(sql`select rolsuper,rolbypassrls from pg_roles where rolname=current_user`);expect(role).toEqual({rolsuper:false,rolbypassrls:false});
    const app=new Hono();const tls=process.env.MCP_TEST_TLS_KEY_FILE?{createServer,serverOptions:{key:readFileSync(process.env.MCP_TEST_TLS_KEY_FILE),cert:readFileSync(process.env.MCP_TEST_TLS_CERT_FILE!)}}:{};
    server=serve({fetch:app.fetch,hostname:"127.0.0.1",port:0,...tls});await new Promise<void>(resolve=>server.listening?resolve():server.once("listening",resolve));
    const address=server.address();if(!address||typeof address==="string")throw Error("loopback required");origin=(process.env.MCP_TEST_TLS_KEY_FILE?"https:":"http:")+"//127.0.0.1:"+address.port;
    env=envSchema.parse({NODE_ENV:"test",DEPLOYMENT_MODE:mode,PUBLIC_APP_URL:origin,API_URL:origin,DATABASE_URL:url,SESSION_SECRET:"synthetic-who469-session-secret-for-disposable-fixtures-only",ENCRYPTION_KEY:"synthetic-reviewed-write-encryption-only",MCP_ENABLED:"true",MCP_SYNTHETIC_DEPLOYMENT:"true",MCP_WRITES_ENABLED:"true",MCP_WRITE_SCOPES:"shopping:write,chores:write",MODULES_ENABLED:"core"});
    auth=createBetterAuth(db,env,{cookiePrefix:"writes"+randomUUID().replaceAll("-",""),deferHouseholdMembership:async()=>true});
    app.all("/auth/*",c=>auth.handler(c.req.raw));app.route("/api/mcp-auth",mcpAuthorizationRoutes(auth.mcp,env));app.route("/api/mcp-writes",mcpWriteRoutes(auth.mcp,env,[adapter]));
    app.route("/disabled",mcpWriteRoutes(auth.mcp,{...env,MCP_WRITES_ENABLED:false},[adapter]));app.route("/empty",mcpWriteRoutes(auth.mcp,env));
    const service=reviewedWrites(auth.mcp,env,[adapter]);
    app.post("/lost-response/:connectionId",async c=>{await service.confirm(c.req.raw.headers,c.req.param("connectionId"),await c.req.json());return c.json({error:"simulated_lost_response"},503);});
    for(let i=0;i<2;i++){const [household]=await withSystemContext(db,tx=>tx.insert(households).values({name:"Fictional write household",modulesEnabled:'["core"]'}).returning());householdIds.push(household.id);}
    const signup=async(householdId:string,role:"owner"|"member"|"child"):Promise<Person>=>{
      const warn=vi.spyOn(console,"warn").mockImplementation(()=>{});
      let response:Response;const email=randomUUID()+"@example.test";
      try{response=await fetch(origin+"/auth/sign-up/email",{method:"POST",headers:{origin,"content-type":"application/json"},body:JSON.stringify({name:"Fictional Write Member",email,password:"Synthetic-only-write-fixture-2026"})});}finally{warn.mockRestore();}
      expect(response.status).toBe(200);
      const {user}=await response.json() as {user:{id:string}};userIds.push(user.id);
      const [member]=await withSystemContext(db,tx=>tx.insert(householdMembers).values({householdId,userId:user.id,role}).returning());
      return{userId:user.id,memberId:member.id,householdId,email,headers:new Headers({origin,"content-type":"application/json",cookie:response.headers.getSetCookie().map(s=>s.split(";")[0]).join("; ")})};
    };
    owner=await signup(householdIds[0],"owner");peer=await signup(householdIds[0],"member");stranger=await signup(householdIds[1],"owner");child=await signup(householdIds[0],"child");
    for(const person of [owner,stranger]){await auth.mcp.setHouseholdEnabled(person.headers,person.householdId,true);await owned(person,tx=>tx.insert(householdSubscriptions).values({householdId:person.householdId,modulesEntitled:'["core"]',status:"active"}));}
    clientId=await register();
  },30000);
  afterAll(async()=>{if(db){await withSystemContext(db,async tx=>{if(householdIds.length)await tx.delete(households).where(inArray(households.id,householdIds));if(userIds.length)await tx.delete(users).where(inArray(users.id,userIds));});await withMcpProviderContext(db,async tx=>{if(clientIds.length)await tx.delete(oauthClient).where(inArray(oauthClient.clientId,clientIds));});await closeDb(db);}await new Promise<void>((resolve,reject)=>server?server.close(error=>error?reject(error):resolve()):resolve());});

  it("keeps production empty, read grants unchanged and write configuration opt-in",async()=>{
    const f=await fixture();expect((await post("/disabled/prepare",{})).status).toBe(404);
    expect((await post("/empty/prepare",{operation:adapter.name,payload:{recordId:f.id,item:"x"},idempotencyKey:randomUUID()},owner,f.token.access_token)).status).toBe(404);
    expect(mcpSupportedScopes({...env,MCP_WRITES_ENABLED:false})).not.toContain("shopping:write");
    const read=await connect(owner,["shopping:read","offline_access"]);
    expect((await post("/api/mcp-writes/prepare",{operation:adapter.name,payload:{recordId:f.id,item:"x"},idempotencyKey:randomUUID()},owner,read.access_token)).status).toBe(403);
    await expect(connect(child)).rejects.toMatchObject({code:"member_not_eligible"});
  });
  it("prepares and reviews server-owned exact values without changing the domain",async()=>{
    const f=await fixture(),before=await f.read();const review=await f.review();
    expect(review).toMatchObject({state:"pending",householdName:"Fictional write household",clientName:"Fictional reviewed writes",preview:{changes:[{field:"Item",before:"Before",after:"After"}]}});
    expect(new URL(f.change.reviewUrl!).origin).toBe(origin);expect(await f.read()).toEqual(before);
    const second=await f.review();expect(second.nonce).toBe(review.nonce);
    const [row]=await owned(owner,tx=>tx.select().from(mcpWriteIntents).where(eq(mcpWriteIntents.id,f.change.intentId)));
    expect(row.envelope).toMatch(/^enc:v1:/);expect(row.envelope).not.toContain("Before");
    const events=await owned(owner,tx=>tx.select().from(mcpWriteEvents).where(eq(mcpWriteEvents.intentId,row.id)));expect(JSON.stringify(events)).not.toMatch(/Before|After/);
  });
  it("rejects foreign sessions, bearer-only confirmation, GET, cross-site and changed confirmation payloads",async()=>{
    const f=await fixture(),view=await f.review(),path="/api/mcp-writes/browser/"+f.token.connectionId+"/confirm";
    for(const person of [peer,stranger])expect((await f.confirm(view,person)).status).toBeGreaterThanOrEqual(400);
    for(const person of [peer,stranger])expect(await owned(person,tx=>tx.select().from(mcpWriteIntents).where(eq(mcpWriteIntents.id,f.change.intentId)))).toHaveLength(0);
    expect((await post(path,{intentId:f.change.intentId,digest:view.digest,nonce:view.nonce},owner,f.token.access_token,{origin})).status).toBe(401);
    expect((await fetch(origin+path,{headers:owner.headers})).status).toBe(405);
    expect((await post(path,{intentId:f.change.intentId,digest:view.digest,nonce:view.nonce},owner,undefined,{origin:"https://evil.example.test"})).status).toBe(403);
    expect((await f.confirm(view,owner,{confirmed:true})).status).toBe(400);
    expect((await f.confirm({...view,nonce:"x".repeat(43)})).status).toBe(409);
    expect((await f.read()).item).toBe("Before");
  });
  it("serializes duplicate preparation and conflicts on a changed payload",async()=>{
    const f=await fixture(),key=randomUUID();const [a,b]=await Promise.all([f.prepare("Identical",key),f.prepare("Identical",key)]);expect(a.intentId).toBe(b.intentId);
    const changed=await post("/api/mcp-writes/prepare",{operation:adapter.name,payload:{recordId:f.id,item:"Different"},idempotencyKey:key},owner,f.token.access_token);expect(changed.status).toBe(409);
    expect((await f.read()).revision).toBe(1);
  });
  it("commits concurrent confirmations once and returns the same attributed receipt",async()=>{
    const f=await fixture(),view=await f.review();const responses=await Promise.all([f.confirm(view),f.confirm(view)]);const results=await Promise.all(responses.map(async r=>{expect(r.status,await r.clone().text()).toBe(200);return await r.json() as Change;}));
    expect(results[0].receiptId).toBeTruthy();expect(results[0]).toEqual(results[1]);expect(await f.read()).toMatchObject({item:"After",revision:2});
    const events=await owned(owner,tx=>tx.select().from(mcpWriteEvents).where(and(eq(mcpWriteEvents.intentId,f.change.intentId),eq(mcpWriteEvents.outcome,"committed"))));expect(events).toHaveLength(1);expect(events[0].sessionHash).toMatch(/^[a-f0-9]{64}$/);
  });
  it("invalidates previews even after an edit is restored to its original value",async()=>{
    const f=await fixture(),view=await f.review();await owned(owner,async tx=>{await tx.update(shoppingItems).set({item:"Human edit"}).where(eq(shoppingItems.id,f.id));await tx.update(shoppingItems).set({item:"Before",revision:999}).where(eq(shoppingItems.id,f.id));});
    const result=await f.confirm(view);expect(await result.json()).toMatchObject({state:"stale"});expect(await f.read()).toMatchObject({item:"Before",revision:3});
  });
  it("rejects cross-row ciphertext substitution",async()=>{
    const f=await fixture(),other=await f.prepare("Other");const [row]=await owned(owner,tx=>tx.select().from(mcpWriteIntents).where(eq(mcpWriteIntents.id,f.change.intentId)));
    await owned(owner,tx=>tx.update(mcpWriteIntents).set({envelope:row.envelope}).where(eq(mcpWriteIntents.id,other.intentId)));
    expect((await post("/api/mcp-writes/browser/"+f.token.connectionId+"/review",{intentId:other.intentId})).status).toBe(404);expect((await f.read()).item).toBe("Before");
  });
  it("expires abandoned previews and refuses denied or changed-version proposals",async()=>{
    const f=await fixture();await owned(owner,tx=>tx.update(mcpWriteIntents).set({expiresAt:new Date(Date.now()-1000)}).where(eq(mcpWriteIntents.id,f.change.intentId)));
    expect(await f.review()).toMatchObject({state:"expired"});
    const g=await fixture(),view=await g.review();adapter.version="2";try{expect(await (await g.confirm(view)).json()).toMatchObject({state:"stale"});}finally{adapter.version="1";}
    const h=await fixture();expect(await (await post("/api/mcp-writes/browser/"+h.token.connectionId+"/reject",{intentId:h.change.intentId})).json()).toMatchObject({state:"rejected"});expect((await h.read()).revision).toBe(1);
  });
  it("returns the recorded terminal outcome idempotently after repeated confirmation",async()=>{
    const stale=await fixture(),staleView=await stale.review();
    await owned(owner,tx=>tx.update(shoppingItems).set({item:"Human edit"}).where(eq(shoppingItems.id,stale.id)));
    for(let i=0;i<2;i++){const response=await stale.confirm(staleView);expect(response.status,await response.clone().text()).toBe(200);expect(await response.json()).toMatchObject({state:"stale"});}
    expect((await stale.confirm({...staleView,nonce:"x".repeat(43)})).status).toBe(409);
    const expired=await fixture(),expiredView=await expired.review();
    await owned(owner,tx=>tx.update(mcpWriteIntents).set({expiresAt:new Date(Date.now()-1000)}).where(eq(mcpWriteIntents.id,expired.change.intentId)));
    for(let i=0;i<2;i++){const response=await expired.confirm(expiredView);expect(response.status,await response.clone().text()).toBe(200);expect(await response.json()).toMatchObject({state:"expired"});}
    const rejected=await fixture(),rejectedView=await rejected.review();
    expect(await (await post("/api/mcp-writes/browser/"+rejected.token.connectionId+"/reject",{intentId:rejected.change.intentId})).json()).toMatchObject({state:"rejected"});
    for(let i=0;i<2;i++){const response=await rejected.confirm(rejectedView);expect(response.status,await response.clone().text()).toBe(200);expect(await response.json()).toMatchObject({state:"rejected"});}
    expect((await rejected.confirm(rejectedView,peer)).status).toBeGreaterThanOrEqual(400);
  });
  it("binds an intent to its original client and immutable grant",async()=>{
    const f=await fixture(),view=await f.review(),otherClient=await register(),other=await connect(owner,scopes,otherClient);
    expect((await post("/api/mcp-writes/status",{intentId:f.change.intentId},owner,other.access_token)).status).toBe(404);
    await auth.mcp.revokeConnection(owner.headers,f.token.connectionId);expect((await f.confirm(view)).status).toBe(401);expect((await f.read()).revision).toBe(1);
  });
  it("revalidates role, household enablement, module and subscription before execution",async()=>{
    for(const gate of ["role","household","module","subscription"]){
      const f=await fixture(),view=await f.review();
      try{
        if(gate==="role")await owned(owner,tx=>tx.update(householdMembers).set({role:"child"}).where(eq(householdMembers.id,owner.memberId)));
        if(gate==="household")await auth.mcp.setHouseholdEnabled(owner.headers,owner.householdId,false);
        if(gate==="module")await owned(owner,tx=>tx.update(households).set({modulesEnabled:"[]"}).where(eq(households.id,owner.householdId)));
        if(gate==="subscription")await owned(owner,tx=>tx.update(householdSubscriptions).set({status:"canceled",currentPeriodEnd:null}).where(eq(householdSubscriptions.householdId,owner.householdId)));
        const response=await f.confirm(view);
        if(gate==="subscription"&&mode==="single")expect(response.status).toBe(200);else{expect(response.status).toBeGreaterThanOrEqual(400);expect((await f.read()).revision).toBe(1);}
      }finally{
        await owned(owner,async tx=>{await tx.update(householdMembers).set({role:"owner"}).where(eq(householdMembers.id,owner.memberId));await tx.update(households).set({modulesEnabled:'["core"]'}).where(eq(households.id,owner.householdId));await tx.update(householdSubscriptions).set({status:"active"}).where(eq(householdSubscriptions.householdId,owner.householdId));});await auth.mcp.setHouseholdEnabled(owner.headers,owner.householdId,true);
      }
    }
  });
  it("rolls back adapter failure and reconciles a lost committed response without replay",async()=>{
    const f=await fixture(),view=await f.review();failApply=true;
    try{expect((await f.confirm(view)).status).toBe(503);}finally{failApply=false;}
    expect(await f.read()).toMatchObject({item:"Before",revision:1});
    const lost=await post("/lost-response/"+f.token.connectionId,{intentId:f.change.intentId,digest:view.digest,nonce:view.nonce});expect(lost.status).toBe(503);
    const status=await post("/api/mcp-writes/status",{intentId:f.change.intentId},owner,f.token.access_token);expect(await status.json()).toMatchObject({state:"committed"});
    expect((await f.confirm(view)).status).toBe(200);expect(await f.read()).toMatchObject({item:"After",revision:2});
    await owned(owner,tx=>tx.update(shoppingItems).set({createdByDisplayName:stranger.userId}).where(eq(shoppingItems.id,f.id)));
    expect((await post("/api/mcp-writes/status",{intentId:f.change.intentId},owner,f.token.access_token)).status).toBe(404);
  });
  it("rolls back a bounded statement timeout without inventing a result",async()=>{
    const f=await fixture(),view=await f.review();timeoutApply=true;try{expect((await f.confirm(view)).status).toBe(503);}finally{timeoutApply=false;}
    expect(await f.read()).toMatchObject({item:"Before",revision:1});
  });
  it("serializes a competing revocation before allowing the domain commit",async()=>{
    const f=await fixture(),view=await f.review();let release!:()=>void,locked!:()=>void;
    const ready=new Promise<void>(resolve=>{locked=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
    const revoke=owned(owner,async tx=>{await tx.update(mcpConnections).set({status:"revoked",revokedAt:new Date()}).where(eq(mcpConnections.id,f.token.connectionId));locked();await gate;});
    await ready;const confirming=f.confirm(view);await new Promise(resolve=>setTimeout(resolve,40));release();await revoke;
    expect((await confirming).status).toBe(401);expect((await f.read()).revision).toBe(1);
  });
  it("binds confirmation to the browser session that displayed the proposal",async()=>{
    const f=await fixture(),view=await f.review();
    await withSystemContext(db,tx=>tx.update(users).set({emailVerified:true}).where(eq(users.id,owner.userId)));
    const login=await fetch(origin+"/auth/sign-in/email",{method:"POST",headers:{origin,"content-type":"application/json"},body:JSON.stringify({email:owner.email,password:"Synthetic-only-write-fixture-2026"})});expect(login.status).toBe(200);
    const other={...owner,headers:new Headers({origin,"content-type":"application/json",cookie:login.headers.getSetCookie().map(s=>s.split(";")[0]).join("; ")})};
    expect((await f.confirm(view,other)).status).toBe(409);
    const reviewed=await post("/api/mcp-writes/browser/"+f.token.connectionId+"/review",{intentId:f.change.intentId},other);expect(reviewed.status).toBe(200);
    expect((await f.confirm(await reviewed.json() as Change,other)).status).toBe(200);expect((await f.read()).revision).toBe(2);
  });
  it("invalidates confirmation when the provider revokes the refresh token",async()=>{
    const f=await fixture(),view=await f.review();
    const revoked=await fetch(origin+"/auth/oauth2/revoke",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:clientId,token:f.token.refresh_token,token_type_hint:"refresh_token"})});expect(revoked.status).toBe(200);
    expect((await f.confirm(view)).status).toBe(401);expect((await f.read()).revision).toBe(1);
  });
  it("preserves a competing human edit instead of applying the old preview",async()=>{
    const f=await fixture(),view=await f.review();let release!:()=>void,locked!:()=>void;
    const ready=new Promise<void>(resolve=>{locked=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
    const editing=owned(owner,async tx=>{await tx.update(shoppingItems).set({item:"Concurrent human edit"}).where(eq(shoppingItems.id,f.id));locked();await gate;});
    await ready;const confirming=f.confirm(view);await new Promise(resolve=>setTimeout(resolve,40));release();await editing;
    expect(await (await confirming).json()).toMatchObject({state:"stale"});expect(await f.read()).toMatchObject({item:"Concurrent human edit",revision:2});
  });
  it("holds authority locks until an approved commit finishes",async()=>{
    const f=await fixture(),view=await f.review();let release!:()=>void,entered!:()=>void;
    const ready=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
    beforeApply=async()=>{entered();await gate;};const confirming=f.confirm(view);await ready;
    let revoked=false;const revoking=auth.mcp.revokeConnection(owner.headers,f.token.connectionId).then(()=>{revoked=true;});
    try{await new Promise(resolve=>setTimeout(resolve,40));expect(revoked).toBe(false);}finally{release();beforeApply=null;}
    expect((await confirming).status).toBe(200);await revoking;expect(await f.read()).toMatchObject({item:"After",revision:2});
    expect((await post("/api/mcp-writes/status",{intentId:f.change.intentId},owner,f.token.access_token)).status).toBe(401);
  });
  it("bounds retention and keeps payloads out of events",async()=>{
    const f=await fixture();await owned(owner,tx=>tx.update(mcpWriteIntents).set({expiresAt:new Date(Date.now()-1000)}).where(eq(mcpWriteIntents.id,f.change.intentId)));
    await db.execute(sql`select app.mcp_prune_write_metadata()`);
    const [expired]=await owned(owner,tx=>tx.select().from(mcpWriteIntents).where(eq(mcpWriteIntents.id,f.change.intentId)));expect(expired).toMatchObject({state:"expired",envelope:null});
    const old=Date.now()-32*86400000;
    await owned(owner,tx=>tx.update(mcpWriteIntents).set({createdAt:new Date(old),expiresAt:new Date(old+60000)}).where(eq(mcpWriteIntents.id,f.change.intentId)));
    await db.execute(sql`select app.mcp_prune_write_metadata()`);
    expect(await owned(owner,tx=>tx.select().from(mcpWriteIntents).where(eq(mcpWriteIntents.id,f.change.intentId)))).toHaveLength(0);
    expect(canonicalWriteJson({b:2,a:1})).toBe(canonicalWriteJson({a:1,b:2}));expect(()=>canonicalWriteJson({x:NaN})).toThrow();
  });
});
