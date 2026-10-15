# celebratingjane.com

A small static site for sharing news about Jane's celebration of life and collecting the names and emails of friends and family who want updates.

- **Hosting:** GitHub Pages builds the site with Jekyll automatically when you push. There's nothing to install or run.
- **Sign-up list:** a Google Sheet you own. The form on the site sends each sign-up to a small Google Apps Script attached to that sheet. No emails are ever stored in this repository, so the repo can be public.
- **Emailing the list:** the same sheet gets a menu that sends a Gmail draft to everyone on the list, one personal copy each.

```
_config.yml              ← Jane's details, event details, sign-up URL (edit this)
_posts/                  ← one Markdown file per update (add these)
index.html               ← the home page
_layouts/, _includes/    ← page templates
assets/css/site.css      ← styles
assets/js/signup.js      ← sign-up form behaviour
assets/img/              ← favicon; put Jane's photo here
google-apps-script/Code.gs  ← paste into the Google Sheet's Apps Script editor
CNAME                    ← tells GitHub Pages the domain is celebratingjane.com
```

---

## 1. Fill in Jane's details

Open `_config.yml` and fill in the `jane:` and `event:` sections. Anything left as `""` is simply not shown. Until `event.date` is filled in, the page says that the date and place will be announced.

To add a photo, put it in `assets/img/` (e.g. `jane.jpg`, ideally about 1200 px wide), then set `photo: "/assets/img/jane.jpg"` and a short `photo_alt` description. The photo is also used as the preview image when someone shares the link in a text or on Facebook.

## 2. Post an update

Add a file to `_posts/` named `YYYY-MM-DD-short-title.md`, for example `_posts/2026-11-02-date-and-place.md`:

```markdown
---
title: Date and place are set
---

We'll gather on Saturday, November 21 at Leach Botanical Garden...
```

Commit and push; the update appears on the home page (newest first) within a minute or two, and gets its own page at `/updates/2026/11/02/date-and-place/`.

You can do this entirely on github.com. In the repo, open `_posts`, choose **Add file → Create new file**, write the post, and click **Commit changes**.

When you post something important, also update `event:` in `_config.yml` so the details at the top of the page match.

## 3. Set up the sign-up list (one time, about 10 minutes)

1. Go to [sheets.new](https://sheets.new) while signed in to the Google account that should own the list. Name the sheet something like "Celebrating Jane – sign-ups".
2. In the sheet, choose **Extensions → Apps Script**. Delete the sample code, paste the entire contents of `google-apps-script/Code.gs`, and click **Save**.
3. Click **Deploy → New deployment**. Click the gear next to "Select type" and choose **Web app**, then set:
   - Description: `sign-up form`
   - Execute as: **Me**
   - Who has access: **Anyone**

   Click **Deploy**. Google will ask you to authorize the script. Because it's your own unverified script, you'll see a "Google hasn't verified this app" screen: click **Advanced → Go to (project name)**, then **Allow**.
4. Copy the **Web app URL** (it ends in `/exec`). Paste it into `_config.yml`:
   ```yaml
   signup_endpoint: "https://script.google.com/macros/s/AKfy.../exec"
   ```
   Commit and push.
5. Check that it works: open the `/exec` URL in a browser. You should see `{"ok":true,"service":"Celebrating Jane sign-up list"}`. Then sign up on the live site with your own email, and a row should appear in a new **Subscribers** tab.

**If you change `Code.gs` later:** in Apps Script choose **Deploy → Manage deployments → ✏️ (edit) → Version: New version → Deploy**. This keeps the same URL. Choosing "New deployment" instead creates a new URL, which you'd then have to paste into `_config.yml` again.

**What the sheet records:** time signed up, name, email, status, and which page they signed up from. Email addresses are stored in lowercase, and a repeat sign-up with the same email is ignored. To take someone off the list, change their **Status** from `subscribed` to anything else (e.g. `unsubscribed`); don't just delete the row if you want to keep a record.

**Spam:** the form has a hidden field that bots fill in and people don't; those submissions are quietly dropped. If junk rows still show up, just delete them.

**Welcome email (optional):** set `SEND_WELCOME_EMAIL = true` at the top of `Code.gs` (and redeploy as above) to send each new sign-up a short confirmation. It's off by default because anyone can type anyone's address into a public form.

## 4. Email an update to everyone

1. In Gmail (same Google account), write the update as a **draft**. Formatting, links and attachments are fine. You can write `{{name}}` anywhere and it becomes each person's first name, e.g. "Dear {{name}},". Leave the To field empty.
2. Open the sign-up sheet and reload it. A **Celebrating Jane** menu appears (the first time, it will ask for permission to read your drafts and send email).
3. **Celebrating Jane → Send a test of a Gmail draft to me**, then type the draft's subject. Check the email you get.
4. **Celebrating Jane → Send a Gmail draft to everyone on the list**, same subject, and confirm.

Each person gets their own copy, so no one sees anyone else's address. The **Last update sent** column records which update each person received, so running it again with the same subject only sends to people who haven't had it yet.

**Daily limit:** a regular Gmail account can send to about 100 recipients a day from a script (Google Workspace accounts get 1,500). If the list is longer, the menu sends as many as it can and tells you; run it again the next day for the rest. Images pasted inline into the draft may not come through; attach them instead.

## 5. Publish on GitHub Pages at celebratingjane.com

1. Create a new repository on GitHub (e.g. `celebrating-jane`) and push this folder to it:
   ```bash
   git init && git add . && git commit -m "Initial site"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/celebrating-jane.git
   git push -u origin main
   ```
2. In the repo on GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, Branch: **main**, folder **/ (root)**, then **Save**.
3. Still in **Settings → Pages**, put `celebratingjane.com` under **Custom domain** and save. (The `CNAME` file in this repo already says this.)
4. At your domain registrar, set these DNS records for `celebratingjane.com`:

   | Type  | Host / Name | Value |
   |-------|-------------|-------|
   | A     | @           | 185.199.108.153 |
   | A     | @           | 185.199.109.153 |
   | A     | @           | 185.199.110.153 |
   | A     | @           | 185.199.111.153 |
   | AAAA  | @           | 2606:50c0:8000::153 |
   | AAAA  | @           | 2606:50c0:8001::153 |
   | AAAA  | @           | 2606:50c0:8002::153 |
   | AAAA  | @           | 2606:50c0:8003::153 |
   | CNAME | www         | YOUR-USERNAME.github.io |

   Remove any other A/AAAA records on `@` (registrars often add a "parked" record).
5. DNS can take anywhere from a few minutes to a day. Once GitHub shows the domain as verified, tick **Enforce HTTPS**.
6. Recommended: verify the domain for your GitHub account (**your profile → Settings → Pages → Add a domain**) so no one else can point it at their own repo.

The GitHub repository needs to be public for free Pages hosting. That's fine here: the only personal data (the sign-up list) lives in your Google Sheet, not in the repo.

## Optional: preview on your own computer

Not needed for publishing. With Ruby installed:

```bash
bundle install
bundle exec jekyll serve
```

Then open http://localhost:4000.

## Hiding from search engines

Set `hide_from_search: true` in `_config.yml` if you'd rather the site not appear in Google results. Anyone with the link can still visit.
