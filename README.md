# Restaurant Time Clock

A phone-friendly web app for restaurant staff to clock in and out with a PIN. Managers can set employee wages, review hours, and export payroll CSV files.

## What it does

- Staff choose their name, enter their PIN, then clock in or out.
- Each shift stores the employee wage at the time they clocked in.
- Admin can add, edit, enable, or disable employees.
- Admin can review payroll by date range.
- Payroll and daily shift records can be exported as CSV.
- A manager can receive a text message when someone clocks in or out.
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

This version still stores records in the browser on the device being used.

For real restaurant use where every employee uses their own phone and records need to sync together, the app should be connected to a cloud database and login system. Good next-step options are Firebase, Supabase, or a small custom server.
