"use client";

import { NoticePanel } from "./NoticePanel";
import { TodayGlance } from "./TodayGlance";
import { WhosHomePanel } from "./WhosHomePanel";

export function DashboardBoard({
  notice,
  whosHome,
}: {
  notice: string;
  whosHome: { id: string; name: string; status: string }[];
}) {
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <NoticePanel initialNotice={notice} />
        <WhosHomePanel initial={whosHome} />
      </div>
      <TodayGlance />
    </div>
  );
}
