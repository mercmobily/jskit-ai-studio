# JSKIT AI Studio Agent Notes

This repository is a JSKIT app. Use JSKIT commands for JSKIT project work, and run them through `npx jskit ...` from the repository. Do not assume a global `jskit` binary exists.

Important boundaries:

- Session truth lives in `<target-root>/.ai-studio/sessions/active/<session_id>/`.
- Studio owns the AI Studio session runtime directly. Inspect AI Studio sessions through `.ai-studio`.
- Use `npx jskit ...` freely for app/framework tasks such as verification, scaffold checks, generator work, JSKIT metadata, and adapter-specific project inspection.
- Do not create loose workboard files.
- Do not run bare `jskit ...`. Use `npx jskit ...`.
