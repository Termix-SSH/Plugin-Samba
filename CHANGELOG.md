# Changelog

## 1.0.1

### Added

- Start, stop, restart and reload Samba through Termix actions, list shares across hosts and see whether Samba runs as a status tile
- Dashboard card with Samba state, shares and sessions on every host
- Shares panel beside SSH terminals

### Fixed

- Notes at the top of the tab no longer squeeze their text to one word per line
- Every view in the tab shows a loading message instead of a blank screen while it loads

### Changed

- Needs Termix 26.11.1 or newer
- Pages use the Termix tile look, with lines between sections instead of separate boxes
- Toolbars, loading screens, back buttons and Save bars match the rest of Termix

## 1.0.0

### Added

- A Samba Shares tab for each host to install and manage Samba over SSH
- Create, edit and delete shares, with a tested config before every change
- Samba users, passwords and Linux groups
- Folder owner, mode and ACL entries for shares
- Connected users, open files and disconnecting a session
- A config editor with testparm, a log viewer and service controls
