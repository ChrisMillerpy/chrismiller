// Moving files between Cathy's box and storage: Chris's attachments into the box, and
// artifacts out of it. No Cloudflare code, so it's tested in plain Node.
import type { Box } from '../../agent/box.ts';
import type { Attachment, FileRef, PublishedArtifact, Visibility } from './conversation.ts';
import { Registry, uploadKey, type Artifact } from './registry.ts';
import { MAX_FILE, mimeFor, shareUrl } from './files.ts';

export const artifactView = (a: Artifact, env: { SHARE_URL?: string }): PublishedArtifact => ({
  id: a.id,
  title: a.title,
  filename: a.filename,
  mime: a.mime,
  size: a.size,
  version: a.version,
  visibility: a.visibility,
  admin_url: `/artifacts/${a.id}`,
  share_url: shareUrl(env, a.token),
});

/** Publish a file from the box as a new artifact, or a new version of one this chat made. */
export async function publishFromBox(
  registry: Registry,
  box: Box,
  sessionId: string,
  env: { SHARE_URL?: string },
  input: { path: string; title: string; visibility?: Visibility; id?: string },
): Promise<PublishedArtifact> {
  if (input.id) {
    const existing = await registry.artifact(input.id);
    if (!existing) throw new Error(`No artifact ${input.id}. Use list_artifacts to find it.`);
    if (existing.session_id !== sessionId) throw new Error(`Artifact ${input.id} belongs to another chat; publish a new one instead.`);
  }
  const bytes = await box.readBytes!(input.path);
  if (bytes.length > MAX_FILE) throw new Error(`${input.path} is ${(bytes.length / 1024 / 1024).toFixed(1)} MB; artifacts can be up to ${MAX_FILE / 1024 / 1024} MB.`);
  const filename = input.path.split('/').pop() || 'file';
  const a = await registry.publish({ session_id: sessionId, title: input.title, filename, mime: mimeFor(filename), visibility: input.visibility, id: input.id }, bytes);
  return artifactView(a, env);
}

/** Put Chris's attachments in the box at /uploads/<id>/<name>, outside the repo, so they're never committed by accident. */
export async function attachToBox(registry: Registry, box: Box, files: FileRef[]): Promise<Attachment[]> {
  return Promise.all(
    files.map(async (f) => {
      const bytes = await registry.getBytes(uploadKey(f.id));
      if (!bytes) throw new Error(`${f.name} is missing from storage. Ask Chris to attach it again.`);
      const path = `/uploads/${f.id}/${f.name}`;
      await box.writeBytes!(path, bytes);
      return { ...f, path, bytes };
    }),
  );
}
