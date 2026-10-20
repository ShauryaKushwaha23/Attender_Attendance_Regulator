# Attender - Smart Attendance Tracker

A complete attendance app in plain HTML, CSS and JavaScript. No install, no build.

## Run it
Open `index.html` in any modern browser. To host it, upload the folder to GitHub Pages or Netlify.

## Files
| File | Purpose |
|------|---------|
| `index.html` | Page structure: sign-in screen, sidebar, five views |
| `style.css`  | Design tokens, light/dark themes, layout, charts |
| `app.js`     | All logic: accounts, maths, rendering, charts, storage |

## Features
- Register / sign in (salted PBKDF2 password hash, per-account data)
- Subjects with Present / Absent / On duty / Cancelled marking, undo, edit, delete
- Exact "classes you can miss" and "classes to attend in a row" (integer maths)
- Semester planner using classes remaining
- Weekly timetable with start/end times, overlap check, and analysis (weekly load, busiest day, longest break, forecast for the next N weeks)
- Live clock, "Now / Next class" bar, and per-slot marking (each lecture is marked on its own)
- Daily class list from each subject's weekdays, with "Mark all present"
- Calendar with day details
- Insights: radar chart, subject comparison, weekday, monthly, status mix, weekly trend
- Needs-attention alerts, attendance streak, sorting, light/dark theme
- CSV export, JSON backup and restore, demo data

## The maths
With `a` attended, `t` held and target `T`%:
- Can miss `m` more: largest integer with `100a >= T(t+m)`, so `m = floor((100a - T t) / T)`
- Must attend `x` in a row: `x = ceil((T t - 100a) / (100 - T))`
- Percentages are rounded down so 74.96% is never shown as 75%.

## Limits
Accounts and data live in each browser's localStorage, so they do not sync between
devices and this is not server-grade security. To make it multi-user, replace the
`ls()` / `ss()` storage helpers and the account functions in `app.js` with API calls
to a backend (for example FastAPI + PostgreSQL).

Change the product name in `app.js`: `var BRAND="Attender";`
<img width="1917" height="837" alt="Screenshot 2026-10-20 180833" src="https://github.com/user-attachments/assets/99e94905-35d5-4c85-b27b-822c50bc6756" />
<img width="1916" height="902" alt="Screenshot 2026-10-20 180858" src="https://github.com/user-attachments/assets/f92d68b8-9db2-49a3-854e-be3a7e6a2ad5" />
<img width="1917" height="882" alt="Screenshot 2026-10-20 180916" src="https://github.com/user-attachments/assets/f9aa5010-a746-4dac-b9e3-1e818e460792" />
<img width="1917" height="902" alt="Screenshot 2026-10-20 180940" src="https://github.com/user-attachments/assets/8fa6cae1-ea0b-4786-9dec-4c5089c2687c" />
<img width="1917" height="895" alt="Screenshot 2026-10-20 181006" src="https://github.com/user-attachments/assets/b8391752-7264-44b7-973d-a0c454c8d53e" />
<img width="1912" height="892" alt="Screenshot 2026-10-20 181033" src="https://github.com/user-attachments/assets/621552bb-72f9-4b3c-bf9c-998638b484c9" />
<img width="1916" height="901" alt="Screenshot 2026-10-20 181053" src="https://github.com/user-attachments/assets/8ebd5e5e-a349-4973-81eb-65fbfca80f49" />
