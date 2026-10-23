export function ProviderDataDisclosure({ provider }: { provider: string }) {
  return <section className="space-y-2 text-sm" aria-label="Data sharing disclosure">
    <h3 className="font-medium">Your information leaves Domi Ops</h3>
    <p>The assistant and its provider receive the information they request within these permissions. Their privacy, retention and training rules apply. Review your account’s settings with that provider; Domi Ops cannot enforce them.</p>
    {provider === "gemini" && <div className="space-y-2 rounded-xl border border-[var(--color-warning)] p-4" role="note" aria-label="Gemini data-use risks">
      <h4 className="font-semibold">Before sharing with Gemini</h4>
      <p>Gemini custom apps require Keep Activity to be on. Google may use chats and connected-app information to train its models, and human reviewers may review some chats. Reviewed chats can be retained for up to three years, even after you delete activity.</p>
      <p>Turning Keep Activity off currently makes custom apps unavailable. If you are not comfortable with this handling, deny the connection or use another assistant. Select only information you are willing to share.</p>
      <p><a className="underline" href="https://support.google.com/gemini/answer/17209137" target="_blank" rel="noopener noreferrer">Google’s custom-app requirements</a>{" · "}<a className="underline" href="https://support.google.com/gemini/answer/13594961?hl=en" target="_blank" rel="noopener noreferrer">Gemini privacy notice</a></p>
    </div>}
    <p>Disconnect stops future access. It cannot erase information already copied into an assistant conversation. Reconnecting replaces this assistant’s previous grant for your household.</p>
  </section>;
}
