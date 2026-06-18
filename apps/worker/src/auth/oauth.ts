/**
 * GitHub OAuth (web flow), Worker-mediated so the client secret never reaches the
 * static frontend. Only the configured owner (`OWNER_GH_ID`) is allowed a session.
 *
 * @packageDocumentation
 */

import type { SessionInfo } from "@second-brain/shared";
import type { Env } from "../env.js";
import { issueSession, issueState, verifyState } from "./session.js";

const AUTHORIZE = "https://github.com/login/oauth/authorize";
const TOKEN = "https://github.com/login/oauth/access_token";
const USER = "https://api.github.com/user";

interface GitHubUser {
  id: number;
  login: string;
  avatar_url: string;
}

/** Build the GitHub authorize URL plus the CSRF state to round-trip. */
export async function buildAuthorizeUrl(env: Env): Promise<{ url: string; state: string }> {
  const state = await issueState(env);
  const params = new URLSearchParams({
    client_id: env.GH_CLIENT_ID,
    scope: "read:user", // identity only; brain writes use the separate GH_TOKEN
    state,
    allow_signup: "false",
  });
  return { url: `${AUTHORIZE}?${params.toString()}`, state };
}

/** Exchange an OAuth code (with CSRF state) for an owner-locked session token. */
export async function completeOAuth(
  env: Env,
  code: string,
  state: string,
): Promise<{ token: string; info: SessionInfo } | { error: string }> {
  if (!(await verifyState(env, state))) return { error: "invalid_state" };

  const tokenRes = await fetch(TOKEN, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.GH_CLIENT_ID,
      client_secret: env.GH_CLIENT_SECRET,
      code,
    }),
  });
  if (!tokenRes.ok) return { error: "token_exchange_failed" };
  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  if (!tokenJson.access_token) return { error: "no_access_token" };

  const userRes = await fetch(USER, {
    headers: {
      Authorization: `Bearer ${tokenJson.access_token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "second-brain-worker",
    },
  });
  if (!userRes.ok) return { error: "user_fetch_failed" };
  const user = (await userRes.json()) as GitHubUser;

  if (String(user.id) !== env.OWNER_GH_ID) return { error: "not_owner" };

  const info: SessionInfo = { login: user.login, avatarUrl: user.avatar_url };
  const token = await issueSession(env, info, user.id);
  return { token, info };
}
