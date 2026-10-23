export function ProviderDataDisclosure({ provider }: { provider: string }) {
  return <section className="space-y-2 text-sm" aria-label="Data sharing disclosure">
    <h3 className="font-medium">Your information leaves Domi Ops</h3>
    <p>The assistant and its provider receive the information they request within these permissions. Their privacy, retention and training rules apply. Review your account’s settings with that provider; Domi Ops cannot enforce them.</p>
    {provider === "chatgpt" && <div className="space-y-2 rounded-xl border border-[var(--color-warning)] p-4" role="note" aria-label="ChatGPT data-use settings">
      <h4 className="font-semibold">Before sharing with ChatGPT</h4>
      <p>Review Settings → Data controls → Improve the model for everyone. On personal accounts, turn it off if you do not want new chats used for model training. Turning it off does not delete saved chats. Feedback may share the associated conversation even after opting out.</p>
      <p>Available controls and retention depend on your account and workspace. Temporary Chat has separate behavior and may retain chats for up to 30 days for safety. Do not assume API or business terms apply to a personal account.</p>
      <a className="underline" href="https://help.openai.com/en/articles/7730893-data-controls-in-chatgpt" target="_blank" rel="noopener noreferrer">ChatGPT data controls</a>
    </div>}
    {provider === "claude" && <div className="space-y-2 rounded-xl border border-[var(--color-warning)] p-4" role="note" aria-label="Claude data-use settings">
      <h4 className="font-semibold">Before sharing with Claude</h4>
      <p>Review your Privacy Settings and Model Improvement choice. Turn model improvement off or use Incognito where appropriate if you do not want conversations used to improve Claude. Raw connector data has separate rules, but content copied into a conversation may be included under its settings.</p>
      <p>Feedback and safety/legal exceptions can retain data longer. Avoid feedback containing household content unless you accept that handling. Domi Ops cannot verify your settings or delete copies already sent to Claude.</p>
      <p><a className="underline" href="https://privacy.claude.com/en/articles/10023580-is-my-data-used-for-model-training" target="_blank" rel="noopener noreferrer">Claude training policy</a>{" · "}<a className="underline" href="https://privacy.claude.com/en/articles/10023548-how-long-do-you-store-my-data" target="_blank" rel="noopener noreferrer">Claude retention policy</a></p>
    </div>}
    {provider === "gemini" && <div className="space-y-2 rounded-xl border border-[var(--color-warning)] p-4" role="note" aria-label="Gemini data-use risks">
      <h4 className="font-semibold">Before sharing with Gemini</h4>
      <p>Gemini custom apps require Keep Activity to be on. Google may use chats and connected-app information to train its models, and human reviewers may review some chats. Reviewed chats can be retained for up to three years, even after you delete activity.</p>
      <p>Turning Keep Activity off currently makes custom apps unavailable. If you are not comfortable with this handling, deny the connection or use another assistant. Select only information you are willing to share.</p>
      <p><a className="underline" href="https://support.google.com/gemini/answer/17209137" target="_blank" rel="noopener noreferrer">Google’s custom-app requirements</a>{" · "}<a className="underline" href="https://support.google.com/gemini/answer/13594961?hl=en" target="_blank" rel="noopener noreferrer">Gemini privacy notice</a></p>
    </div>}
    <p>Disconnect stops future access. It cannot erase information already copied into an assistant conversation. Reconnecting replaces this assistant’s previous grant for your household.</p>
  </section>;
}
