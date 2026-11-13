// What a person is told when signing in to Motif did not end with them signed in, by the reason in the address.
export const AUTH_NOTICES: Record<string, string> = {
  denied: "Sign-in was cancelled.",
  state: "That sign-in wasn't started in this browser, so it wasn't finished. Try again.",
  failed: "Sign-in didn't complete. Try again.",
  unavailable: "The sign-in provider couldn't be reached. Try again in a moment.",
  "not-allowed": "That account isn't allowed to sign in here. Ask whoever runs this site to add your email address.",
  "no-verified-email": "The provider didn't confirm an email address for you, so there's nothing to sign you in with.",
  "private-email": "Your Apple ID hid your email address, so it can't be matched to the list of who may sign in. Sign in with Apple again and choose to share your email, or use another way.",
  "github-email": "GitHub didn't share a verified email address. Make sure the app has permission to read email addresses, or use another way.",
  rate: "Too many attempts. Try again in a few minutes.",
};
