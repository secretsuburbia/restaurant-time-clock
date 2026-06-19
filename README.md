# Restaurant Time Clock

A phone-friendly web app for restaurant staff to clock in and out with a PIN. Managers can set employee wages, review hours, and export payroll CSV files.

## What it does

- Staff choose their name, enter their PIN, then clock in or out.
- Each shift stores the employee wage at the time they clocked in.
- Admin can add, edit, enable, or disable employees.
- Admin can review payroll by date range.
- Payroll and daily shift records can be exported as CSV.
- A manager can receive a text message when someone clocks in or out.
- Shared restaurant records are stored through Netlify Functions and Netlify Blobs so multiple phones can use the same time clock.
- The app can be installed to a phone home screen when hosted on HTTPS or opened from localhost.

## First login

- Admin PIN: `1234`
- Demo employees:
  - Alex, PIN `1111`
  - Sam, PIN `2222`

Change the restaurant name and admin PIN in Admin > Settings.

## Test on this computer

Open `index.html` in a browser. The core app will work directly from the file.

For full install behavior, host the folder on a local or online web server. Progressive web app installation needs HTTPS, except on localhost.

## Phone install

After the app is hosted:

- iPhone: open the link in Safari, tap Share, then Add to Home Screen.
- Android: open the link in Chrome, tap the menu, then Install app or Add to Home screen.

## Text message alerts

Text alerts are sent through a Netlify Function, so the SMS credentials stay private. The current implementation expects Twilio.

In Netlify, add these environment variables under Site configuration > Environment variables:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM_NUMBER`
- `NOTIFY_TO_NUMBER`

Use full phone numbers with country code, for example `+14165551234`.

## Important note about shared records

This version stores shared records in Netlify Blobs through `netlify/functions/time-clock-data.js`.

Each phone keeps a local backup copy in the browser, but the live Netlify site loads and saves the central restaurant record when employees clock in/out or when managers change employees/settings.

Staff browsers only receive employee names, clock status, and shift times. Employee PINs, wages, payroll values, and manager-only changes are handled by the Netlify Function after the manager PIN or employee PIN is submitted.

The next hardening step is replacing the shared manager PIN with individual manager accounts and an audit trail for edits.
