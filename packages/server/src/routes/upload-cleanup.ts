import { rmdir, unlink } from 'fs/promises';

/** The subset of an uploaded file this module needs. */
export interface CleanupFile {
  path: string;
}

/**
 * Remove one message's uploads after the model has finished reading them.
 *
 * The directory is keyed by CONVERSATION, not by message, so a message queued
 * behind this one has already written its own uploads into the same place.
 * That is why the directory is removed with `rmdir` and not a recursive
 * delete: `rmdir` refuses with ENOTEMPTY when someone else's file is still
 * there, which is exactly the intent.
 *
 * It used to be `rm(dir, { recursive: true, force: true })`, and the symptom
 * was precise: send a screenshot while the previous turn is still running, and
 * the model meant to read it finds an empty directory. The previous turn's
 * cleanup had deleted the whole folder, including the file that had just
 * arrived for the next message.
 *
 * Every failure is reported, never thrown. Failing to tidy up must not fail
 * the turn that produced the files.
 */
export async function cleanupUploads(
  files: readonly CleanupFile[],
  uploadDir: string,
  onWarn: (err: NodeJS.ErrnoException, context: { filePath?: string; uploadDir?: string }) => void
): Promise<void> {
  for (const f of files) {
    await unlink(f.path).catch((err: NodeJS.ErrnoException) => {
      // Already gone is the outcome we wanted.
      if (err.code === 'ENOENT') return;
      onWarn(err, { filePath: f.path });
    });
  }

  await rmdir(uploadDir).catch((err: NodeJS.ErrnoException) => {
    // ENOENT: someone else removed it. ENOTEMPTY: a queued message's uploads
    // are still in there and are not ours to delete.
    if (err.code === 'ENOENT' || err.code === 'ENOTEMPTY') return;
    onWarn(err, { uploadDir });
  });
}
