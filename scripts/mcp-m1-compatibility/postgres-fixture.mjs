import assert from "node:assert/strict";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { pgTable, text, uuid, boolean, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getAuthTables } from "better-auth/db";

const snake=s=>s.replace(/[A-Z]/g,x=>"_"+x.toLowerCase());
const quote=s=>'"'+s.replaceAll('"','""')+'"';
export async function createPostgresFixture(options) {
  // This fixed loopback database belongs to the disposable M1 container, never .env.
  const sql=postgres("postgres://mcp_probe:synthetic-local-probe-only@127.0.0.1:55487/mcp_probe",{max:3,onnotice:()=>{}});
  const tables=getAuthTables(options);
  const schema={};
  const snapshot={};
  for(const [key,definition] of Object.entries(tables)){
    const model=definition.modelName??key;
    const tableName=snake(model);
    const columns={id:uuid("id").primaryKey()};
    const ddl=['"id" uuid primary key'];
    snapshot[model]={table:tableName,fields:{}};
    for(const [fieldName,field] of Object.entries(definition.fields)){
      if(fieldName==="id")continue;
      const property=field.fieldName??fieldName;
      const column=snake(property);
      let builder,sqlType;
      if(field.type==="date"){builder=timestamp(column,{withTimezone:true});sqlType="timestamptz";}
      else if(field.type==="boolean"){builder=boolean(column);sqlType="boolean";}
      else if(field.type==="number"){builder=integer(column);sqlType="integer";}
      else if(field.type==="string[]"){builder=text(column).array();sqlType="text[]";}
      else if(field.type==="number[]"){builder=integer(column).array();sqlType="integer[]";}
      else if(field.type==="json"){builder=jsonb(column);sqlType="jsonb";}
      else if(field.references?.field==="id"){builder=uuid(column);sqlType="uuid";}
      else {builder=text(column);sqlType="text";}
      if(field.required)builder=builder.notNull();
      if(field.unique)builder=builder.unique();
      columns[property]=builder;
      ddl.push(quote(column)+" "+sqlType+(field.required?" not null":"")+(field.unique?" unique":""));
      snapshot[model].fields[property]={column,type:sqlType,required:!!field.required};
    }
    await sql.unsafe("create table "+quote(tableName)+" ("+ddl.join(",")+")");
    schema[model]=pgTable(tableName,columns);
  }
  const db=drizzle(sql,{schema});
  return {
    adapter:drizzleAdapter(db,{provider:"pg",schema}),
    schema:snapshot,
    close:()=>sql.end({timeout:5}),
    async verifyTenantPlan(){
      await sql.unsafe("create role mcp_restricted login password 'synthetic-restricted-only' nosuperuser nobypassrls");
      await sql.unsafe("grant usage on schema public to mcp_restricted");
      await sql.unsafe("create table mcp_grant_fixture (id uuid primary key, household_id uuid not null, member_id uuid not null, revoked_at timestamptz)");
      await sql.unsafe("alter table mcp_grant_fixture enable row level security");
      await sql.unsafe("create policy household_scope on mcp_grant_fixture for all using (household_id::text = current_setting('app.current_household_id',true)) with check (household_id::text = current_setting('app.current_household_id',true))");
      await sql.unsafe("grant select,insert,update,delete on mcp_grant_fixture to mcp_restricted");
      const [a,b]=["11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222"];
      await sql`insert into mcp_grant_fixture values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',${a},'dddddddd-dddd-4ddd-8ddd-dddddddddddd',null),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',${b},'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',null)`;
      const limited=postgres("postgres://mcp_restricted:synthetic-restricted-only@127.0.0.1:55487/mcp_probe",{max:1,onnotice:()=>{}});
      try{
        const [role]=await limited`select rolsuper,rolbypassrls from pg_roles where rolname=current_user`;
        assert.equal(role.rolsuper,false);assert.equal(role.rolbypassrls,false);
        assert.equal((await limited`select * from mcp_grant_fixture`).length,0);
        await limited.begin(async tx=>{
          await tx`select set_config('app.current_household_id',${a},true)`;
          const rows=await tx`select * from mcp_grant_fixture`;
          assert.equal(rows.length,1);assert.equal(rows[0].household_id,a);
          assert.equal((await tx`update mcp_grant_fixture set revoked_at=now() where household_id=${b} returning id`).length,0);
        });
        assert.equal((await limited`select * from mcp_grant_fixture`).length,0);
        await limited.begin(async tx=>{
          await tx`select set_config('app.current_household_id',${b},true)`;
          const rows=await tx`select * from mcp_grant_fixture`;
          assert.equal(rows.length,1);assert.equal(rows[0].household_id,b);
        });
        const single=await sql`select * from mcp_grant_fixture where household_id=${a}`;
        assert.equal(single.length,1);
      }finally{await limited.end({timeout:5});}
    }
  };
}
