"use client";

import { useState } from "react";
import { Loader2, LogOut, User, X } from "lucide-react";
import {
  getProfileByUsername,
  getSupabase,
  isSupabaseConfigured,
  type AppUser,
  type Profile,
} from "@/lib/supabase";
import ThemePicker from "@/components/ThemePicker";
import type { StyleId } from "@/lib/style";

function isValidUsername(value: string): boolean {
  return /^[a-zA-Z0-9_]{3,20}$/.test(value);
}

/**
 * Supabase auth errors are terse and technical ("Invalid login
 * credentials"). Translate the common ones into plain language — the
 * raw message never tells the student what to do next.
 */
function friendlyAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials"))
    return "That email and password don't match an account. Check for typos, or create a new account below.";
  if (m.includes("email not confirmed"))
    return "That email address hasn't been confirmed yet. Check your inbox for the confirmation email.";
  if (m.includes("user already registered") || m.includes("already exists"))
    return "An account with that email already exists — sign in instead.";
  if (m.includes("password") && m.includes("6 characters"))
    return "Passwords need at least 6 characters.";
  if (m.includes("too many requests") || m.includes("rate limit"))
    return "Too many tries — wait a minute and try again.";
  if (m.includes("network") || m.includes("fetch"))
    return "Could not reach the sign-in service. Check your connection and try again.";
  return message;
}

export default function AuthModal({
  open,
  onClose,
  user,
  profile,
  onAuthChanged,
  style,
  onStyleChange,
}: {
  open: boolean;
  onClose: () => void;
  user: AppUser | null;
  profile: Profile | null;
  onAuthChanged: () => void;
  style: StyleId;
  onStyleChange: (id: StyleId) => void;
}) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!open) return null;

  const configured = isSupabaseConfigured();
  const sb = getSupabase();

  async function handleSignOut() {
    if (!sb) return;
    setBusy(true);
    await sb.auth.signOut();
    setBusy(false);
    onAuthChanged();
    onClose();
  }

  async function handleSubmit() {
    if (!sb || !configured) return;
    setMessage(null);
    if (!email.trim() || !password) {
      setMessage("Enter your email and password.");
      return;
    }
    if (password.length < 6) {
      setMessage("Your password needs at least 6 characters.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "signup") {
        const cleanUsername = username.trim().toLowerCase();
        if (!isValidUsername(cleanUsername)) {
          setMessage(
            "Pick a username with 3–20 letters, numbers, or underscores."
          );
          setBusy(false);
          return;
        }
        const taken = await getProfileByUsername(cleanUsername);
        if (taken) {
          setMessage("That username is already taken — try another one.");
          setBusy(false);
          return;
        }
        const name = displayName.trim() || cleanUsername;
        const { data, error } = await sb.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { username: cleanUsername, display_name: name } },
        });
        if (error) {
          setMessage(error.message);
          setBusy(false);
          return;
        }
        const newUser = data.user;
        if (newUser) {
          const { error: profileError } = await sb.from("profiles").insert({
            user_id: newUser.id,
            username: cleanUsername,
            display_name: name,
          });
          if (profileError) {
            setMessage(
              "Account created, but the username could not be saved. Try signing in — if your profile is missing, pick a different username."
            );
            setBusy(false);
            return;
          }
        }
        setMessage(
          "Account created — you are signed in. Welcome to StudySMART!"
        );
      } else {
        const { error } = await sb.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) {
          setMessage(friendlyAuthError(error.message));
          setBusy(false);
          return;
        }
        setMessage("Signed in — welcome back!");
      }
      onAuthChanged();
      window.setTimeout(onClose, 900);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="card animate-pop w-full max-w-md p-6 shadow-lift"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
            <User className="h-5 w-5 text-brand-600" /> Your Account
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1.5 text-ink-400 hover:bg-ink-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {!configured && (
          <p className="feedback-neutral mt-4">
            Accounts are not set up yet — the StudySMART Supabase project
            still needs to be connected. You can still generate study guides
            without an account.
          </p>
        )}

        {configured && user && (
          <div className="mt-4 space-y-3">
            <p className="text-sm leading-relaxed text-ink-600">
              Signed in as{" "}
              <strong>{profile?.display_name ?? user.email}</strong>
              {profile?.username ? ` (@${profile.username})` : ""}
            </p>
            <p className="text-xs leading-relaxed text-ink-400">
              Your email is never shown to anyone. Other people only see your
              username and display name.
            </p>
            <button
              type="button"
              onClick={handleSignOut}
              disabled={busy}
              className="btn-secondary"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <LogOut className="h-4 w-4" />
              )}
              Sign out
            </button>
          </div>
        )}

        {configured && !user && (
          <div className="mt-4 space-y-3">
            <div className="flex gap-1.5 rounded-xl bg-ink-100/70 p-1">
              {(["signin", "signup"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setMode(m);
                    setMessage(null);
                  }}
                  className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                    mode === m
                      ? "bg-white text-brand-700 shadow-soft"
                      : "text-ink-500"
                  }`}
                >
                  {m === "signin" ? "Sign in" : "Sign up"}
                </button>
              ))}
            </div>
            {mode === "signup" && (
              <>
                <div>
                  <label className="text-sm font-bold" htmlFor="auth-username">
                    Username
                  </label>
                  <input
                    id="auth-username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="your_username"
                    className="input mt-1"
                  />
                  <p className="mt-1 text-xs text-ink-400">
                    3–20 letters, numbers, or underscores. This is how friends
                    find you — it is public.
                  </p>
                </div>
                <div>
                  <label
                    className="text-sm font-bold"
                    htmlFor="auth-display-name"
                  >
                    Display name (optional)
                  </label>
                  <input
                    id="auth-display-name"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Defaults to your username"
                    className="input mt-1"
                  />
                </div>
              </>
            )}
            <div>
              <label className="text-sm font-bold" htmlFor="auth-email">
                Email
              </label>
              <input
                id="auth-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="input mt-1"
              />
              <p className="mt-1 text-xs text-ink-400">
                Only used to sign you in. It is never shown to anyone.
              </p>
            </div>
            <div>
              <label className="text-sm font-bold" htmlFor="auth-password">
                Password
              </label>
              <input
                id="auth-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                className="input mt-1"
              />
            </div>
            {message && <p className="feedback-neutral">{message}</p>}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={busy}
              className="btn-primary w-full justify-center"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {mode === "signin" ? "Sign in" : "Create account"}
            </button>
          </div>
        )}

        {/* Style picker lives in Account too — it is per-device, and it
            syncs to the account when signed in. */}
        <div className="mt-5 border-t border-ink-100 pt-4">
          <ThemePicker
            variant="panel"
            style={style}
            onStyleChange={onStyleChange}
            userId={user?.id ?? null}
          />
        </div>
      </div>
    </div>
  );
}
