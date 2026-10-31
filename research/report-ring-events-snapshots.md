# Feasibility: Ring events and fresh snapshots (RFP scope items 1 and 2)
Research date: 2026-10-31. Desk research only, no hardware. **[UNVERIFIED]** marks claims not confirmed from a primary source; they need to be measured on the device.

## Verdicts
| Question | Verdict | Confidence |
|---|---|---|
| **Event delivery**: motion and doorbell-press events reach Node on the Mac within 3 s | **CONDITIONAL GO.** Wired doorbell: probably meets 3 s. Battery doorbell: borderline, about 2-6 s, with occasional long outliers. | Medium |
| **Snapshot freshness**: an image taken after the motion, in hand within 3 s | **CONDITIONAL.** Wired doorbell with a Ring plan: likely GO. Battery doorbell: GO only through the snapshot attached to the push notification (Ring's "Rich Notifications"), which needs a paid plan. Otherwise, pulling a frame from the live stream is the reliable route. It takes about 3-6 s, so it misses the 3 s target but fits the 8 s end-to-end budget, and the stream has to be opened for the speaker anyway. | Medium-low |

**Day-1 blocker.** The latest npm release, `ring-client-api@14.3.0` (2026-02-08), pins `@eneris/push-receiver` to exactly `4.3.0`. Since about late October 2026, Firebase Cloud Messaging (FCM) sends a `crypto-key` header that 4.3.0 parses wrongly (`slice(3)`). Every push fails to decrypt with `ERR_CRYPTO_ECDH_INVALID_PUBLIC_KEY`, so **no motion or ding events arrive at all**.
- The fix is already on GitHub `main` (push-receiver 4.4.0) but has not been released to npm.
- Workaround: add `"overrides": {"@eneris/push-receiver": "4.4.0"}` to package.json and confirm with `npm ls @eneris/push-receiver`, or install ring-client-api from git `main`.
- Sources: https://github.com/dgreif/ring/issues/1877 (2026-10-29), #1860 (2026-10-11), #1709 (2026-02-07, open).

## 1. Event delivery (ring-client-api over FCM push)

**How it works.**
- The library registers with FCM as an Android client and keeps a persistent connection to `mtalk.google.com:5228` (wiki: https://github.com/dgreif/ring/wiki/Notification-Troubleshooting).
- Events are exposed as `onNewNotification`, `onDoorbellPressed`, `onMotionDetected` and `onMotionStarted` (`ring-camera.ts` on `main`).
- Polling was removed in v11.

**The Ring app's notification settings must be on.** The push the library receives is the same push the phone app gets.
- ring-mqtt FAQ: "If you want ring-mqtt to receive all notifications they must be fully enabled in the Ring app." Smart Alerts "will suppress notifications for ring-mqtt as well" (https://github.com/tsightler/ring-mqtt/wiki/Frequently-Asked-Questions-(FAQ)).
- Modes that disable motion, or motion alerts turned off for the device, also stop events.
- Option: give the Mac its own shared-user account so the phone's notification filters don't apply to it.

**Breakage history, 2024-2026:**
- v13.0.0 (2024-08-04) moved to the FCM v1 push interface. v13.0.1 (2024-08-08) updated push-receiver. v13.2.1 (2024-12-07) added handling for push connection errors.
- #1709 (2026-02): push decryption errors cause events to be lost.
- #1860 and #1877 (2026-10): events stopped completely. Swapping in push-receiver 4.4.0 fixes it for most users. One macOS user also had to clear stale devices and make a new token.
- #1829 (2026-09, closed): FCM connects but nothing arrives. Fixed by removing stale "Authorized Client Devices" in the Ring app's Control Center and making a new token. A maintainer said the current solution "works for >10K users… troubleshooting fixes 95%."
- **#1866 (2026-10-22, open): no motion events from the newest 4K models (`cocoa_doorbell_v5`, `cocoa_floodlight_v2`).** Risk if the doorbell is a 2025-2026 4K model.

**Saving the token and push credentials.**
- The "refresh token" the library hands back is base64 JSON holding `rt` (the Ring token), `hid` (a hardware ID derived from the macOS system UUID) and `pnc` (the FCM push credentials). Source: `rest-client.ts` and `util.ts`.
- Save the token on every `onRefreshTokenUpdated` event. Otherwise each restart registers a new push device. Ring caps the number of push devices, and once stale ones pile up, notifications stop.
- Set a stable `controlCenterDisplayName` so the device is easy to find in Control Center.

**Duplicates and missed events (verified in the code):**
- **`onMotionStarted` fires only when motion goes from "none active" to "active", and each ding stays active for 65 s.** A second group within about 65 s of the first will not fire it. Use `onNewNotification` instead and de-duplicate on `data.event.ding.id`.
- On battery cameras, one event can arrive as two notifications. The second carries `img.snapshot_uuid`. homebridge-ring waits up to 2 s for it.
- Pushes in the first 2 s after startup are ignored.
- **Ring cameras do not send motion alerts while a live stream or recording is active** (ring-mqtt Video-Streaming wiki). While the talk session is open for one group, the next group will likely be missed. Whether a doorbell press during a session is delivered is **[UNVERIFIED]**.

**Latency numbers:**
- A sample push in PR #1435 shows `triggered_at` to `sent_at` = **84 ms** on Ring's side (https://github.com/dgreif/ring/pull/1435).
- FCM delivery is usually under a second **[UNVERIFIED]**.
- Reddit anecdotes: a wired 4K doorbell notifies "within about 0.5 s"; a Battery Doorbell Plus is "sometimes instant, sometimes 3-5 min late" (https://www.reddit.com/r/Ring/comments/1x9jni5/, https://www.reddit.com/r/Ring/comments/1vptpzr/). Smart Alerts likely add delay. All **[UNVERIFIED]**.
- **Expected against the ≤3 s target:** wired about 0.5-2.5 s (likely passes); battery about 2-6 s (borderline). Miss rate under 5% once patched and with notifications fully on **[UNVERIFIED]**.
- **How to measure:** log `Date.now()` on arrival next to the payload's `analytics.triggered_at` and `eventito.timestamp` (Ring clocks, some skew). For true motion-to-event time, film the walk-up with an NTP-synced clock in frame. Doorbell presses give the cleanest timestamp.

## 2. Snapshots

**What the library does (verified in `ring-camera.ts`):**
- `getSnapshot()` calls `app-snaps.ring.com/snapshots/next/{id}?after-ms&extras=force`.
  - Reuses a cached image for 10 s (600 s with `avoidSnapshotBatteryDrain` on a battery camera).
  - Times out after 15 s with "unable to capture snapshots while streaming."
  - Throws if `motion_detection_enabled === false`, which Modes or turning off "Record Motion" can cause.
- `getSnapshot({uuid})` fetches the image the camera took for that notification (the Rich Notification image).
- `canTakeSnapshotWhileRecording` is false on battery power and also for the wired budget doorbell (`doorbell_graham_cracker`).

**Battery vs wired:**
- Wiki (https://github.com/dgreif/ring/wiki/Snapshot-Limitations): battery cameras, "even when plugged in," cannot take a snapshot while recording. Motion blocks new snapshots for **30-40 s**, so motion snapshots are "**most likely stale**." Wired cameras: "no more than 10 seconds old."
- ring-mqtt FAQ: high-power devices respond "in a few milliseconds." Low-power devices are slow to wake and can only get a motion snapshot through the notification image, which needs **a Ring plan and Rich Notifications enabled**.
- #1794 (2026-07, open): the image fetch by UUID sometimes returns **404**, so that route needs a fallback.

**Snapshot routes compared:**

| Route | Fresh? | Time from event | Needs plan | Notes |
|---|---|---|---|---|
| A. Image attached to the push (`getSnapshot({uuid})`) | Yes, taken when motion triggered | Wired about 0.5-2 s. Battery: wait up to 2 s for the second push, then fetch; about 1-4 s total **[UNVERIFIED]** | **Yes**, plus Rich Notifications | Fastest and best quality. Can 404. Visitor may be far away or at frame edge. |
| B. Forced `getSnapshot()` (wired only) | Only if response `timeMillis` is after the event | About 0.5-2 s **[UNVERIFIED]** | No | Check the timestamp because of the 10 s cache. Stale or fails on battery and on the budget wired doorbell. |
| C. Frame from the live stream (`startLiveCall`/`streamVideo` + `ffmpeg -frames:v 1`) | Always | About 2-6 s wired, longer on battery **[UNVERIFIED]**. HomeKit users report 10-15 s incl. HomeKit overhead. | No | Works on battery during a recording. Reuses the session the speaker needs. Risks below. |
| D. Official Partner API image download | Taken from the recording | Unknown, likely over 3 s: returns `425 RECORDING_NOT_READY` until the recording exists | Yes | Watermark on every image. See §3. |

**Risks for route C:**
- **ring-client-api offers only H.264** (`streaming/peer-connection.ts`). Ring is moving new 4K "Retinal" models to H.265/HEVC. Scrypted #2045 (2026-05, open) reports the 2026 Wired Doorbell Pro 3rd Gen "never streams" for that reason. Whether this hits ring-client-api on this model is **[UNVERIFIED]**.
- Streams drop after about 30 s with "Timeout waiting for ping." The fix (PR #1834, merged 2026-10-06) **is not on npm yet**. Second reason to run from git `main`.
- v14.3.0 blocks streaming when the current Ring Mode disables live view (PR #1705).
- Keep video end-to-end encryption (E2EE) off. Applying the Partner API's E2EE limitation to ring-client-api is **[UNVERIFIED]**.

**Expected against the ≤3 s target:** wired, or battery with a plan and Rich Notifications: about 1-3 s through route A (likely passes). Battery without a plan: route C at about 3-6 s (likely fails this line, but stays within 8 s end to end).

## 3. Ring official Appstore Partner API
- **Offers:** GA since 2025-04-21, `motion_detected` and `button_press` webhooks, live video over WebRTC and (since 2026-07) RTSPS, clips, and an image download endpoint (https://developer.amazon.com/docs/ring/api-documentation.html, https://developer.amazon.com/docs/ring/release-notes.html).
- **No audio-out path.** Media is receive-only (`recvonly`).
- **An individual can use it now.** "Private Use Apps" (added 2026-07-21) skip certification. Allowlist up to 10 Ring accounts; no review wait documented (https://developer.amazon.com/docs/ring/publish.html#private-use-apps). Playground with 30-minute tokens since 2026-05-28. Setup probably same-day **[UNVERIFIED]**.
- **Catches:** needs a Ring plan; webhook endpoint must respond within 5 s and be reachable from Ring (home Mac needs a tunnel; public HTTPS likely but **[UNVERIFIED]**); watermark burned into all media since 2026-06-08; images come from recordings so may not exist yet right after the event (`425 RECORDING_NOT_READY`); no webhook latency figures published. (https://community.amazondeveloper.com/t/a-few-ring-api-questions/27757, https://community.amazondeveloper.com/t/obtaining-a-camera-snapshot/28387)
- **Recommendation:** not the main route for the 5-day test. Backup event or frame source only.

## 4. Alternatives
- **Home Assistant Ring integration:** same FCM path (outbound port 5228), polls other data every 60 s. No two-way audio. Last recording needs a plan (https://www.home-assistant.io/integrations/ring/). No latency advantage.
- **ring-mqtt:** built on ring-client-api plus a Go gateway that handles H.265. Linux/Docker only. Useful as a reference for the snapshot-UUID logic.
- **go2rtc** (v1.9.13+): Ring source with `&snapshot` option and two-way audio, but **no motion or ding events** (https://go2rtc.org/internal/ring/).
- **Scrypted:** same H.264-only problem on 4K models (#2045).

## 5. Night images
- Ring support (https://ring.com/support/articles/83hut/Night-Vision-in-Ring-devices): newer devices record true color in dim light and switch to black-and-white infrared when fully dark. Older devices have a "Color Night Vision" toggle.
- True-color night vision advertised on Wired Doorbell 4K Pro, Battery Doorbell 4K Pro and Battery Doorbell Plus. Basic Battery and Wired models appear to be infrared black and white **[UNVERIFIED per model]**.
- **Effect on costume comments:** in infrared, colors are lost; silhouettes, masks and props still read. Infrared washes out close faces and reflective fabric.
- **Fix: leave the porch light on.** In the Gemini prompt, avoid naming colors when the frame is black and white.
- Ring's Computer Vision Guidelines (2026-10-19) list night, backlit and wide-angle shots as failure cases and warn that vision-language models hallucinate (https://developer.amazon.com/docs/ring/computer-vision-guidelines.html).

## 6. Does the unofficial API need a Ring plan?

| Feature | No plan | Plan |
|---|---|---|
| Motion and ding events | Yes | Yes |
| Live view and talk session | Yes | Yes |
| `getSnapshot()` on demand | Yes when idle; wired also while recording | Yes |
| Image attached to the notification (fresh battery snapshots) | **No** | Yes |
| Recordings and history video | No | Yes |

Sources: ring-mqtt maintainer (https://github.com/tsightler/ring-mqtt/discussions/874), ring-mqtt FAQ and Configuration-Details (updated 2026-10), Ring support (https://ring.com/support/articles/lw54x/Understanding-Ring-Protect-subscriptions). A 30-day trial is enough for the test.

## Recommended approach
1. **Install:** ring-client-api from git `main`, or 14.3.0 with the push-receiver 4.4.0 override. Save every `onRefreshTokenUpdated` token to a local file. Set a stable `controlCenterDisplayName`. Clear stale Authorized Client Devices in Control Center before the first run. Make sure nothing blocks `mtalk.google.com:5228`.
2. **Ring app settings on the Mac's account:** motion alerts on, Smart Alerts not filtering, Rich Notifications on, no Mode disabling motion or live view, E2EE off, motion frequency "Frequent." Start a plan trial if there is no plan.
3. **Events:** listen on `onNewNotification` and de-duplicate on `ding.id`. Log receive time, `triggered_at`, `eventito.timestamp` and category.
4. **On each event, run in parallel:**
   - (a) If the push has a snapshot UUID, fetch it with `getSnapshot({uuid})`. On battery, wait up to 2 s for the second push first.
   - (b) **Start the live call immediately.** The speaker needs it anyway. Grab the first keyframe with ffmpeg and use it if (a) is slow or 404s. A second frame about 1 s later may show the visitor closer.
   - (c) Wired only: try a forced `getSnapshot()` and accept it only if `timeMillis` is after the event.
5. Play the "Ooh, who's this?" filler clip as soon as the talk session opens.
6. **Fallbacks:** if push fails, poll `camera.getEvents()` every 2-3 s (slow, may be throttled). If every snapshot route fails, play the stock line. The Partner API private app is a further backup for events or frames, at the cost of watermarks and a tunnel.

## Open questions only hardware can answer
1. Exact model, `kind` string and `power_mode`. Is it one of the new 4K `cocoa_*` / HEVC models affected by #1866 or Scrypted #2045?
2. Motion-to-event and press-to-event delay and miss rate over 20+ trials, day and night, and how much Smart Alerts adds.
3. Is the snapshot UUID in the first or second notification, how fast does it fetch, and how often does it 404?
4. Live-call time to first frame, wired vs battery, on npm 14.3.0 vs `main`.
5. During an open talk session, are new motion events or doorbell presses delivered? How soon after the session ends do events resume?
6. Night: color or infrared at the actual porch-light level, and is infrared good enough for costume comments?
7. Is a plan or trial active? This decides whether route A is available.
8. Does the session cap or the 30 s ping timeout cut off one greet cycle?
