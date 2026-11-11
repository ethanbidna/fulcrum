# Supplemental upstream notices

Published crate archives omit some workspace-root license files. Overrides are
limited to exact package versions, repository and SHA-256 in overrides.json.
Review them on version changes; unknown versions fail.

- objc2.txt: upstream objc2 LICENSE.md plus LICENSE-MIT.txt, retrieved from
  https://github.com/madsmtm/objc2/tree/master on 2026-11-10. MIT option selected.
- alloc-stdlib.txt: BSD text from its sibling alloc-no-stdlib 3.0.0 archive in
  the same dropbox/rust-alloc-no-stdlib project.
- selectors.txt: standard MPL-2.0 text, matching cssparser 0.37.0's license;
  selectors 0.38.0 metadata declares MPL-2.0. Its exact source URL is included.
- tauri-plugin.txt: MIT text from tauri 2.12.5's published LICENSE-MIT, same
  Tauri Apps Contributors project. MIT option selected for tauri-plugin 2.7.2.

Other notice texts come directly from the installed exact-version packages.
