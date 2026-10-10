# Profile: display name and profile image

[User guide](../README.md) · [Setup and sign-in](setup-and-sign-in.md)

## Change your name and image

1. Open the Clisbot web app and go to **Settings → Account**.
2. In **Profile**, click **Edit**.
3. Edit **Display name** (1–100 characters).
4. Paste a **Profile image link**, or leave it empty to remove the image.
5. Click **Save profile**.

The name and image show on your Hub account, in member lists and as the actor in sessions. If the image fails to load, the app shows your initials.

You can edit this only in the Clisbot web app served from the same address as the Hub. The native and desktop apps do not have this section yet.

## Accepted image links

The Hub **has no image upload yet**. The image is a link, and the link must meet every condition:

- Starts with `https://`.
- The host is on the trusted list, or is a subdomain of a host on the list. The default list is `googleusercontent.com`, `gravatar.com` and `githubusercontent.com`.
- No credentials (`user:pass@`), no port, no IP address.
- At most 2048 characters.

| Link                                                     | Result                         |
| -------------------------------------------------------- | ------------------------------ |
| `https://lh3.googleusercontent.com/a/...` (Google image) | Accepted                       |
| `https://avatars.githubusercontent.com/u/12345`          | Accepted                       |
| `https://www.gravatar.com/avatar/<hash>`                 | Accepted                       |
| `https://i.imgur.com/abc.png`                            | Rejected: host not on the list |
| `http://lh3.googleusercontent.com/a/...`                 | Rejected: not https            |

When a link is rejected, the app shows **Use an https image link from a host this Hub trusts**.

The Hub does not check that the link is really an image. To get your Google image link: open your Google profile picture and choose **Copy image address**.

## Operators: change the host list

```dotenv
CLISBOT_PROFILE_IMAGE_HOSTS=googleusercontent.com,gravatar.com,githubusercontent.com,cdn.acme.com
```

Restart the Hub after changing it. This variable **replaces** the default list, so list the default hosts again if you still need them.

Add only hosts you trust. Every app and Host that displays accounts loads the images, so the owner of that host can see who is viewing.
