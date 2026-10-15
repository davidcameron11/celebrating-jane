/**
 * Celebrating Jane: sign-up list backend
 * ---------------------------------------------------------------
 * Lives inside a Google Sheet (Extensions > Apps Script). It:
 *   1. receives sign-ups from celebratingjane.com and adds them to the
 *      "Subscribers" tab, skipping emails that are already there, and
 *   2. adds a "Celebrating Jane" menu to the sheet for emailing an
 *      update (written as a Gmail draft) to everyone on the list.
 *
 * Setup steps are in setup.md, "Set up the sign-up list".
 */

// ----- Settings -----------------------------------------------------------
var SHEET_NAME = 'Subscribers';
var SITE_NAME = 'Celebrating Jane';
var SITE_URL = 'https://celebratingjane.com';

// Send a short "you're on the list" email to each new sign-up?
// Off by default: anyone can type any address into a public form.
var SEND_WELCOME_EMAIL = false;

// Column layout of the Subscribers tab (1-based)
var COL = { TIME: 1, NAME: 2, EMAIL: 3, STATUS: 4, SOURCE: 5, LAST_SENT: 6 };
var HEADERS = ['Signed up', 'Name', 'Email', 'Status', 'Signed up from', 'Last update sent'];


// ----- Web endpoint -------------------------------------------------------

function doPost(e) {
  var p = (e && e.parameter) || {};

  // Honeypot: the hidden "website" field is only ever filled in by bots.
  if (p.website) return json_({ ok: true, status: 'added' });

  var name = clean_(p.name, 100);
  var email = clean_(p.email, 254).toLowerCase();

  if (!name) return json_({ ok: false, error: 'Enter your name.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return json_({ ok: false, error: 'Enter an email address like name@example.com.' });
  }

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
  } catch (err) {
    return json_({ ok: false, error: 'The list is busy. Please try again in a moment.' });
  }

  var status;
  try {
    var sheet = getSheet_();
    if (findRow_(sheet, email) > 0) {
      status = 'exists';
    } else {
      sheet.appendRow([new Date(), safeCell_(name), email, 'subscribed', clean_(p.page, 200), '']);
      status = 'added';
    }
  } finally {
    lock.releaseLock();
  }

  if (status === 'added' && SEND_WELCOME_EMAIL) {
    try {
      MailApp.sendEmail({
        to: email,
        subject: "You're on the list: " + SITE_NAME,
        body: 'Hi ' + name.split(' ')[0] + ',\n\n' +
              "Thank you for signing up. We'll email you when there's news about the celebration.\n\n" +
              SITE_URL + '\n\nIf this wasn\'t you, just reply and we\'ll take you off the list.',
        name: SITE_NAME
      });
    } catch (err) { /* quota reached; the sign-up itself is saved */ }
  }

  return json_({ ok: true, status: status });
}

// Visiting the web app URL in a browser shows this; handy for checking the deployment.
function doGet() {
  return json_({ ok: true, service: SITE_NAME + ' sign-up list' });
}


// ----- Sheet menu ---------------------------------------------------------

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu(SITE_NAME)
    .addItem('Send a test of a Gmail draft to me', 'menuSendTest')
    .addItem('Send a Gmail draft to everyone on the list', 'menuSendToList')
    .addSeparator()
    .addItem('Set up the Subscribers tab', 'setupSheet')
    .addToUi();
}

function menuSendTest() {
  var ui = SpreadsheetApp.getUi();
  var draft = askForDraft_(ui);
  if (!draft) return;
  var me = Session.getActiveUser().getEmail();
  sendDraftTo_(draft, me, 'Test Reader');
  ui.alert('Sent a test to ' + me + '. {{name}} was filled in as "Test".');
}

function menuSendToList() {
  var ui = SpreadsheetApp.getUi();
  var draft = askForDraft_(ui);
  if (!draft) return;
  var subject = draft.getMessage().getSubject();

  var sheet = getSheet_();
  var last = sheet.getLastRow();
  if (last < 2) { ui.alert('There is no one on the list yet.'); return; }

  var rows = sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();
  var todo = [];
  rows.forEach(function (r, i) {
    var email = String(r[COL.EMAIL - 1]).trim();
    var status = String(r[COL.STATUS - 1]).trim().toLowerCase();
    var already = String(r[COL.LAST_SENT - 1]) === subject;
    if (email && status === 'subscribed' && !already) {
      todo.push({ row: i + 2, name: String(r[COL.NAME - 1]), email: email });
    }
  });

  if (!todo.length) {
    ui.alert('Everyone who is subscribed has already been sent "' + subject + '".');
    return;
  }

  var quota = MailApp.getRemainingDailyQuota();
  var msg = 'Send "' + subject + '" to ' + todo.length + ' people?\n\n' +
            'Each person gets their own copy, so no one sees anyone else\'s address.';
  if (quota < todo.length) {
    msg += '\n\nGoogle allows ' + quota + ' more emails from this account today, so the first ' +
           quota + ' will go now. Run this again tomorrow to send the rest; ' +
           'people who already got it are skipped.';
  }
  if (ui.alert(msg, ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;

  var sent = 0, failed = [];
  for (var i = 0; i < todo.length && sent < quota; i++) {
    try {
      sendDraftTo_(draft, todo[i].email, todo[i].name);
      sheet.getRange(todo[i].row, COL.LAST_SENT).setValue(subject);
      sent++;
    } catch (err) {
      failed.push(todo[i].email);
    }
  }

  var left = todo.length - sent - failed.length;
  var report = 'Sent to ' + sent + ' people.';
  if (left > 0) report += '\n' + left + ' still to go; run this again tomorrow.';
  if (failed.length) report += '\nCouldn\'t send to: ' + failed.join(', ');
  ui.alert(report);
}


// ----- Helpers ------------------------------------------------------------

function setupSheet() {
  getSheet_();
}


function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  var first = sheet.getRange(1, 1, 1, HEADERS.length);
  if (first.getValues()[0].join('') === '') {
    first.setValues([HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.getRange('A:A').setNumberFormat('yyyy-mm-dd h:mm am/pm');
  }
  return sheet;
}

function findRow_(sheet, email) {
  var last = sheet.getLastRow();
  if (last < 2) return -1;
  var emails = sheet.getRange(2, COL.EMAIL, last - 1, 1).getValues();
  for (var i = 0; i < emails.length; i++) {
    if (String(emails[i][0]).trim().toLowerCase() === email) return i + 2;
  }
  return -1;
}

function askForDraft_(ui) {
  var res = ui.prompt(
    'Which Gmail draft?',
    'Write the update as a draft in Gmail first (you can use {{name}} for each person\'s first name). ' +
    'Then type the draft\'s exact subject line here:',
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return null;
  var subject = res.getResponseText().trim();
  var drafts = GmailApp.getDrafts().filter(function (d) {
    return d.getMessage().getSubject() === subject;
  });
  if (!drafts.length) { ui.alert('No Gmail draft found with the subject "' + subject + '".'); return null; }
  if (drafts.length > 1) { ui.alert('More than one draft has that subject. Rename one and try again.'); return null; }
  return drafts[0];
}

function sendDraftTo_(draft, email, fullName) {
  var m = draft.getMessage();
  var first = String(fullName || '').trim().split(/\s+/)[0] || 'friend';
  var fill = function (s) { return String(s).replace(/\{\{\s*name\s*\}\}/gi, first); };
  GmailApp.sendEmail(email, fill(m.getSubject()), fill(m.getPlainBody()), {
    htmlBody: fill(m.getBody()),
    attachments: m.getAttachments(),
    name: SITE_NAME
  });
}

function clean_(value, max) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, max);
}

// Stop names like "=HYPERLINK(...)" from being treated as formulas.
function safeCell_(s) {
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
