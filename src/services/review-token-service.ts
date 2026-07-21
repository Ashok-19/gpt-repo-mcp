import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { RepoReaderError } from "../runtime/errors.js";
import { GitService } from "./git-service.js";

type ReviewState = {
  repoId: string;
  root: string;
  headSha: string;
  paths: string[];
  hashes: Record<string, string>;
  expiresAt: string;
};

const reviews = new Map<string, ReviewState>();
const TTL_MS = 30 * 60 * 1000;

export async function issueReviewToken(repoId: string, root: string, headSha: string, paths: string[]) {
  const reviewId = randomUUID();
  const expiresAt = new Date(Date.now() + TTL_MS).toISOString();
  reviews.set(reviewId, {
    repoId,
    root,
    headSha,
    paths: [...paths].sort(),
    hashes: Object.fromEntries(await Promise.all(paths.map(async (path) => [path, await hashFile(join(root, path))]))),
    expiresAt
  });
  return { review_id: reviewId, review_expires_at: expiresAt };
}

export async function verifyReviewToken(reviewId: string, repoId: string, root: string) {
  const review = reviews.get(reviewId);
  if (!review || review.repoId !== repoId || review.root !== root) {
    throw new RepoReaderError("GIT_REVIEW_TOKEN_INVALID", "Review token is unknown or belongs to another repository.");
  }
  if (Date.parse(review.expiresAt) <= Date.now()) {
    reviews.delete(reviewId);
    throw new RepoReaderError("GIT_REVIEW_TOKEN_INVALID", "Review token has expired.");
  }
  const headSha = (await new GitService(root).status()).head_sha;
  if (headSha !== review.headSha) {
    throw stale(review, headSha);
  }
  for (const path of review.paths) {
    if (await hashFile(join(root, path)).catch(() => "") !== review.hashes[path]) {
      throw stale(review, headSha);
    }
  }
  return { paths: review.paths, expected_head_sha: review.headSha };
}

function stale(review: ReviewState, headSha: string) {
  return new RepoReaderError("GIT_REVIEW_TOKEN_STALE", "Reviewed paths or HEAD changed after review.", {
    diagnostics: { head_sha: headSha, expected_head_sha: review.headSha, expected_paths: review.paths }
  });
}

async function hashFile(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}
