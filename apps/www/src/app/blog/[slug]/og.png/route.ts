import { renderPostShareImage } from "@/lib/blog/share-image";

// Re-check the America/Chicago date gate on every request, like the post page,
// so a future post's card is never prerendered into the standalone build.
export const dynamic = "force-dynamic";

type ShareImageContext = {
  params: Promise<{ slug: string }>;
};

export async function GET(_request: Request, { params }: ShareImageContext): Promise<Response> {
  const { slug } = await params;
  return renderPostShareImage(slug);
}
