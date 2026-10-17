---
name: artifacts
description: Making files for Chris (worksheets, notes, pages, images, PDFs) and sharing them. Read before publishing an artifact.
---

# Artifacts

An artifact is a file you publish for Chris. He sees it as a card in this chat, with a preview, and on the Artifacts page in admin. Use one whenever you make something for him to read, print or send on, rather than pasting it into the chat.

## Publishing

1. Write the file in your box. Use `/tmp/` unless it belongs in the repo.
2. Call `publish_artifact` with the `path` and a short `title`.
3. Tell Chris in a sentence what it is. The card is already in the chat, so don't paste the file too.

To change one you've published, edit the file and call `publish_artifact` again with its `id`. That makes a new version under the same link. Use `list_artifacts` to find ids. You can only update artifacts from this chat.

## Which format

- **Markdown (`.md`)** for worksheets, notes and anything mostly text. It's rendered in the house style with maths: `$x^2$` inline, `$$\frac{a}{b}$$` on its own line. This is usually the right choice.
- **HTML (`.html`)** for anything interactive or with a precise layout. Keep it to one file: put CSS and JS inline, and load libraries from a CDN. It runs sandboxed, so it can't use cookies, storage or admin's API.
- **Images, PDFs, CSV and so on** as they are. Anything else downloads.

Up to 25 MB per file.

## Who can open it

- `private` (the default): only Chris, from admin, behind his login.
- `link`: anyone with the link. Use it only when Chris asks to share. The tool's reply gives you the link to pass on.

Never put student or parent details (names, schools, marks, contact details) in an artifact set to `link`. If Chris asks to share something that has them, say so and offer a version without them.

Chris can switch visibility, make a new link (which kills the old one) or delete an artifact himself, from the card or the Artifacts page.

## Files Chris sends you

His attachments are in your box at `/uploads/<id>/<name>`, outside the repo so they're never committed. You see images and PDFs directly; read other types with your tools.
