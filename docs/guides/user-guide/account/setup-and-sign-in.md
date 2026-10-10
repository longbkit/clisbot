# Hub setup, sign-in and registration

[User guide](../README.md) · [Profile](profile.md) · [Password and recovery](password-and-recovery.md) · [Q&A](../help/faq.md)

Open the Hub in the Clisbot web app at **Settings → Account**. The native and desktop apps open this same page in a browser to sign in, then return to the app.

The **Welcome** screen has two groups of Host sources: **Managed Hosts** (the **Clisbot Hub** tile) and **Your own computer** (QR, pairing link, direct, Remote SSH on desktop). You can use both at once, so the lower group stays after you sign in to the Hub.

After you sign in from Welcome, if the organization already has a Host you can use, the app goes straight to the workspace. With no Host yet, **Settings → Account** shows **Add your first Host** at the top: **Add via Hub** opens the `hub connect` instructions and Host approval; **Connect directly** opens the daemon address/password form, saves the Host on the device and opens it. A Member with no granted Host sees how to request access through **View shared Hosts** and still has the direct option. The app waits for the Host list to load; a load error shows a Retry button. A registered Host, even offline or without connection details, counts as a Host. Any missing account steps (choosing an organization, changing the password…) still come first. On later visits to Welcome, the **Clisbot Hub** tile shows the signed-in account and the Host status: connecting, the organization has shared no Host, the Host has not published how to connect, or a Host save error with a **Retry** button. **Refresh Hosts** reloads the Host list from the Hub, like the button of the same name in **Settings → Hosts**.

Close Welcome with the **✕** button at the top right to go to the main screen; from there the **Add a Host** tile reopens Welcome. The **⚙** button next to it opens Settings.

## Operators: turn on Google and choose how people register

Set these variables in the Hub's environment, then restart the Hub:

```dotenv
CLISBOT_GOOGLE_AUTH_CLIENT_ID=...apps.googleusercontent.com
CLISBOT_GOOGLE_AUTH_CLIENT_SECRET=...
CLISBOT_REGISTRATION_MODE=invite_only
CLISBOT_REGISTRATION_ALLOWED_DOMAINS=
```

- **Google:** turns on only when both variables are set; with only one, the Hub does not start. In Google Cloud Console, add the Authorized redirect URI `<Hub URL>/api/auth/callback/google` exactly, for example `https://hub.example.com/api/auth/callback/google`.
- **`invite_only`** (personal Hub): only invited people can create an account.
- **`domain_self_registration`** (company Hub): people with an email on a domain in `CLISBOT_REGISTRATION_ALLOWED_DOMAINS` (for example `acme.com`) can register themselves. Invitations still work for people outside the domain.
  - Domains match exactly; list subdomains separately.
  - Public email domains such as `gmail.com` are not allowed.
- **Email registration** (only in `domain_self_registration`): needs Resend mail sending configured. The sending domain must be verified in Resend. Without it, people can register only with Google or an invitation.

```dotenv
CLISBOT_RESEND_API_KEY=re_...
CLISBOT_RESEND_FROM="Clisbot <accounts@acme.com>"
```

To turn it off: remove the two Google variables, or switch back to `invite_only`. Accounts created with Google have no password, so they cannot sign in until Google is turned on again.

## First-time Hub setup

A new Hub with no accounts shows **Set up Hub**. The first person becomes the Owner and the Hub **operator**.

1. Choose **Continue with Google** (recommended): Google has verified the email and the account needs no password.
   - In `domain_self_registration`, if the email is on an allowed domain, the first organization takes the domain's name. Colleagues who register later join this organization.
2. Without Google: choose **Set up with email and password instead** and enter an email and a password of at least 12 characters.
   - This email is not verified.
   - The Hub **does not link Google to this operator account automatically**; the operator keeps signing in with the password. Reason: if you mistype the email as someone else's, that person cannot use Google to get into the operator account.
3. If someone set it up first, the app shows **This Hub was already set up by someone else**. Sign in with an invited or existing account.

## Sign in

- **Continue with Google:** available when the Hub has Google on.
  - The first time, if a password account with the same email exists, Google is linked to it; permissions, organization and data are kept.
  - If that password account never verified its email (for example, created from an invitation), the Hub signs out old sessions, revokes CLI credentials and drops the old password. From then on you sign in only with Google.
- **Email and password:** when the Hub has Google on, the sign-in screen shows only **Continue with Google**; click **Use email and password instead** to open the email form, including to create an account or get a sign-up link.
- **Several organizations:** choose the organization after signing in. The CLI and Hosts use the selected organization.

## Register a new account

| Case                             | How                                                                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| You have an invitation           | Open the invitation link, sign in or create an account with the invited email, then accept the invitation.                                                          |
| Company email, Hub has Google on | **Continue with Google** with your company email. The first person on the domain is the Owner; later people are Members.                                            |
| Company email, without Google    | Choose **Create an account**, enter your email, click **Email me a sign-up link**. Open the link in the email, enter a name and password, click **Create account**. |

About email sign-up links:

- A link lasts 30 minutes and works once.
- The account is created only after you set a password on the page the link opens. Someone typing your email cannot create an account or password.
- Each email gets at most 1 link per minute and 5 links per hour.
- The app does not reveal whether an email already has an account. If no email arrives, try signing in or ask the Owner.

## Common errors

| Message                                                                          | What to do                                                                                                                          |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| This Google account isn't admitted to this Hub (`registration_closed`)           | The email has no invitation and the domain is not allowed. Ask the Owner to invite you, or use a company email on the right domain. |
| Google hasn't verified this email address (`google_email_unverified`)            | Use a Google account with a verified email.                                                                                         |
| Linked to a different Hub account (`account_already_linked_to_different_user`)   | This Google account is already tied to another Hub account. The operator resolves it by hand; the Hub does not merge accounts.      |
| Hub doesn't link Google to this account automatically (`unable_to_link_account`) | The account is an operator created with a password. Sign in with the password.                                                      |
| This Hub was already set up by someone else (`instance_unavailable`)             | The Hub already has an operator. Sign in to your account or ask for an invitation.                                                  |
| Sign-up link expired / already used                                              | Go back to **Create an account** and send a new link. If the link was used, sign in.                                                |
| This Hub can't send email yet                                                    | The operator has not configured Resend. Use Google or an invitation.                                                                |
| `redirect_uri_mismatch` on the Google page                                       | The redirect URI in Google Cloud does not match `<Hub URL>/api/auth/callback/google`.                                               |
