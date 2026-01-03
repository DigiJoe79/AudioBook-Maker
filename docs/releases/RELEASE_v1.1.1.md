# Release v1.1.1 - Remote Backend Connectivity Fix

This is a **hotfix release** that resolves a critical issue preventing the desktop app from connecting to remote Docker backends.

## Bug Fix

### Remote Backend Connection Failure

**Symptoms:**
- Desktop app shows "Offline" when connecting to remote backends (e.g., `http://server:8765`)
- Browser can reach the same backend URL successfully
- No network traffic visible in Wireshark when app attempts connection

**Root Cause:**
The Content Security Policy (CSP) in `tauri.conf.json` was restricting HTTP connections to `localhost:8765` and `127.0.0.1:8765` only. When users configured a remote backend URL, the CSP silently blocked all fetch requests before they could leave the app.

**Fix:**
Updated CSP directives to allow connections to any host:

| Directive | Before | After |
|-----------|--------|-------|
| `connect-src` | `localhost:8765`, `127.0.0.1:8765` | `http://*:*`, `https://*:*`, `ws://*:*`, `wss://*:*` |
| `img-src` | `localhost:8765`, `127.0.0.1:8765` | `http://*:*`, `https://*:*` |
| `media-src` | `localhost:8765`, `127.0.0.1:8765` | `http://*:*`, `https://*:*` |

This enables the desktop app to connect to:
- Local backends (`localhost`, `127.0.0.1`)
- Remote backends on LAN (`192.168.x.x`, hostnames)
- Remote backends over internet (any URL configured by user)

## Affected Versions

- **v1.1.0** - Remote backend connections blocked
- **v1.1.1** - Fixed

## Upgrade Notes

No database migration required. Simply replace the desktop app with v1.1.1.

## Acknowledgments

Thanks to the following community members for their contributions:

**Bug Reports:**
- [u/k8-bit](https://www.reddit.com/user/k8-bit/) - Remote backend connection issue with Wireshark captures
- [u/GaryDUnicorn](https://www.reddit.com/user/GaryDUnicorn/) - Remote backend connection issue with Wireshark captures

**Security Feedback:**
- [u/coder543](https://www.reddit.com/user/coder543/) - Corrected misleading SSH key security description 

---

**Full Changelog**: https://github.com/DigiJoe79/audiobook-maker/compare/v1.1.0...v1.1.1
