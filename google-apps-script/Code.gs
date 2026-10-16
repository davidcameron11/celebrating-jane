/**
 * Celebrating Jane: sign-up list backend
 * ---------------------------------------------------------------
 * Lives inside a Google Sheet (Extensions > Apps Script). It:
 *   1. receives sign-ups from celebratingjane.com and adds them to the
 *      "Subscribers" tab, skipping emails that are already there,
 *   2. receives remembrances and adds them to the "Remembrances" tab;
 *      ones shared with everyone appear on the site once the family
 *      ticks "Show on site", and family-only ones are emailed to the
 *      addresses in the "Family" tab as replies in one ongoing thread, and
 *   3. adds a "Celebrating Jane" menu to the sheet for emailing an
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

// Remembrances
var REM_SHEET_NAME = 'Remembrances';
// true: remembrances shared with everyone wait for the family to tick "Show on site".
// false: they appear on the site straight away (the family can untick to hide one).
var REQUIRE_APPROVAL = true;
// Email the sheet's owner whenever a new remembrance shared with everyone arrives
// (so someone knows to tick "Show on site").
var NOTIFY_ON_REMEMBRANCE = true;

// Family-only remembrances are emailed to every address in the "Family" tab,
// all in one email thread. If that tab is empty they go to the sheet's owner instead.
var FAMILY_SHEET_NAME = 'Family';
var FAMILY_THREAD_SUBJECT = 'Private remembrances of Jane';
// Gmail stops adding to a conversation at 100 messages; start a new one well before that.
var FAMILY_THREAD_MAX = 90;

var REM_COL = { TIME: 1, NAME: 2, TEXT: 3, VISIBILITY: 4, SHOW: 5, EMAIL: 6, SOURCE: 7 };
var REM_HEADERS = ['Submitted', 'Signed as', 'Remembrance', 'Who can read it', 'Show on site', 'Email (optional)', 'Submitted from'];
var VIS_LABEL = { 'public': 'Everyone', 'family': 'Family only' };

// Column layout of the Subscribers tab (1-based)
var COL = { TIME: 1, NAME: 2, EMAIL: 3, STATUS: 4, SOURCE: 5, LAST_SENT: 6 };
var HEADERS = ['Signed up', 'Name', 'Email', 'Status', 'Signed up from', 'Last update sent'];


// ----- Web endpoint -------------------------------------------------------

function doPost(e) {
  var p = (e && e.parameter) || {};
  if (p.form === 'remembrance') return handleRemembrance_(p);

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

// ?action=remembrances returns the remembrances approved for everyone to see.
// Visiting the plain web app URL shows a status message; handy for checking the deployment.
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action === 'remembrances') return json_({ ok: true, items: publicRemembrances_() });
  return json_({ ok: true, service: SITE_NAME + ' sign-up list' });
}


// ----- Remembrances -------------------------------------------------------

function handleRemembrance_(p) {
  if (p.website) return json_({ ok: true });

  var text = cleanText_(p.text, 5000);
  var name = clean_(p.name, 80);
  var vis = p.visibility === 'family' ? 'family' : 'public';
  var email = clean_(p.email, 254).toLowerCase();

  if (!text) return json_({ ok: false, error: 'Write your remembrance before sharing.' });
  if (!name) return json_({ ok: false, error: "Enter how you'd like to sign it, for example Ann S." });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return json_({ ok: false, error: 'Check your email address, or leave it blank.' });
  }

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
  } catch (err) {
    return json_({ ok: false, error: 'The site is busy. Please try again in a moment.' });
  }

  var added = false, row = 0, sheet;
  try {
    sheet = getRemSheet_();
    if (!isDuplicateRemembrance_(sheet, name, text)) {
      sheet.appendRow([new Date(), safeCell_(name), safeCell_(text), VIS_LABEL[vis], '', email, clean_(p.page, 200)]);
      row = sheet.getLastRow();
      if (vis === 'public') {
        sheet.getRange(row, REM_COL.SHOW).insertCheckboxes().setValue(!REQUIRE_APPROVAL);
      }
      sheet.getRange(row, REM_COL.TEXT).setWrap(true);
      added = true;
    }
  } finally {
    lock.releaseLock();
  }

  if (added && vis === 'family') {
    var result = sendToFamilyThread_({ text: text, name: name, email: email, when: new Date() });
    try { sheet.getRange(row, REM_COL.SHOW).setValue(result); } catch (err) {}
  } else if (added && NOTIFY_ON_REMEMBRANCE) {
    try {
      var owner = Session.getEffectiveUser().getEmail();
      var how = REQUIRE_APPROVAL
        ? 'They chose to share it with everyone. To show it on the site, tick "Show on site" in the Remembrances tab.'
        : 'They chose to share it with everyone, and it is already on the site. Untick "Show on site" to hide it.';
      var msg = {
        to: owner,
        subject: 'New remembrance from ' + name,
        body: text + '\n\n-- ' + name + (email ? ' (' + email + ')' : '') + '\n\n' + how + '\n\n' +
              SpreadsheetApp.getActiveSpreadsheet().getUrl(),
        name: SITE_NAME
      };
      if (email) msg.replyTo = email;
      MailApp.sendEmail(msg);
    } catch (err) { /* quota reached; the remembrance itself is saved */ }
  }

  return json_({ ok: true });
}

// ----- Family email thread ------------------------------------------------
//
// The first family-only remembrance starts a new email to everyone in the Family tab.
// Each later one is sent as a reply in that same conversation, so it stacks up in one
// thread in everyone's inbox. Uses the Gmail advanced service (see setup.md) so the
// replies carry the headers mail apps use to keep them together; without it, messages
// still go out with the same subject, which most mail apps also group together.

function sendToFamilyThread_(r) {
  var to = familyEmails_();
  var fallbackToOwner = to.length === 0;
  if (fallbackToOwner) to = [Session.getEffectiveUser().getEmail()];

  var when = Utilities.formatDate(r.when, Session.getScriptTimeZone(), "MMMM d, yyyy 'at' h:mm a");
  var body = r.text + '\n\n— ' + r.name + '\n\n' +
    (r.email ? 'Their email: ' + r.email + ' (write to them directly; replying here goes to the family).\n' : '') +
    'Shared with the family only on ' + when + ' through ' + SITE_URL.replace(/^https?:\/\//, '') + '.' +
    (fallbackToOwner ? '\n\n(The Family tab in the sign-up sheet is empty, so this came to you only. ' +
                       'Add family email addresses there and later remembrances will go to them.)' : '');

  try {
    if (typeof Gmail !== 'undefined') {
      sendThreadedWithGmailApi_(to, body);
    } else {
      GmailApp.sendEmail(to.join(','), FAMILY_THREAD_SUBJECT, body, { name: SITE_NAME });
    }
    return fallbackToOwner ? 'Emailed to owner (Family tab empty)' : 'Emailed to family';
  } catch (err) {
    console.error('Family email failed: ' + err);
    return 'Email to family failed';
  }
}

function sendThreadedWithGmailApi_(to, body) {
  var props = PropertiesService.getScriptProperties();
  var threadId = props.getProperty('FAMILY_THREAD_ID');
  var rootId = props.getProperty('FAMILY_THREAD_ROOT');      // Message-ID header of the first email
  var part = Number(props.getProperty('FAMILY_THREAD_PART') || '1');

  if (threadId) {
    try {
      var t = Gmail.Users.Threads.get('me', threadId, { format: 'minimal' });
      if (!t.messages || t.messages.length >= FAMILY_THREAD_MAX) { threadId = null; part += 1; }
    } catch (err) {
      threadId = null; // thread deleted
    }
  }

  var subject = FAMILY_THREAD_SUBJECT + (part > 1 ? ' (part ' + part + ')' : '');
  var headers = [
    'From: ' + encodeHeader_(SITE_NAME) + ' <' + Session.getEffectiveUser().getEmail() + '>',
    'To: ' + to.join(', '),
    'Subject: ' + encodeHeader_(threadId ? 'Re: ' + subject : subject),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64'
  ];
  if (threadId && rootId) {
    headers.push('In-Reply-To: ' + rootId);
    headers.push('References: ' + rootId);
  }
  var mime = headers.join('\r\n') + '\r\n\r\n' +
    Utilities.base64Encode(body, Utilities.Charset.UTF_8).replace(/(.{76})/g, '$1\r\n');
  var raw = Utilities.base64EncodeWebSafe(mime, Utilities.Charset.UTF_8);

  var resource = { raw: raw };
  if (threadId) resource.threadId = threadId;
  var sent = Gmail.Users.Messages.send(resource, 'me');

  if (!threadId) {
    var meta = Gmail.Users.Messages.get('me', sent.id, { format: 'metadata', metadataHeaders: ['Message-ID'] });
    var hdr = (meta.payload.headers || []).filter(function (h) { return /^message-id$/i.test(h.name); })[0];
    props.setProperties({
      FAMILY_THREAD_ID: sent.threadId,
      FAMILY_THREAD_ROOT: hdr ? hdr.value : '',
      FAMILY_THREAD_PART: String(part)
    });
  }
}

function familyEmails_() {
  var sheet = getFamilySheet_();
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var seen = {};
  return sheet.getRange(2, 1, last - 1, 1).getValues()
    .map(function (r) { return String(r[0]).trim().toLowerCase(); })
    .filter(function (e) {
      if (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/.test(e) || seen[e]) return false;
      seen[e] = true; return true;
    });
}

function getFamilySheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(FAMILY_SHEET_NAME) || ss.insertSheet(FAMILY_SHEET_NAME);
  var first = sheet.getRange(1, 1, 1, 2);
  if (first.getValues()[0].join('') === '') {
    first.setValues([['Email', 'Name (optional, for your reference)']]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 280);
  }
  return sheet;
}

// "=?UTF-8?B?...?=" encoding so names and subjects with accents or curly quotes survive.
function encodeHeader_(s) {
  return /^[\x20-\x7E]*$/.test(s) ? s : '=?UTF-8?B?' + Utilities.base64Encode(s, Utilities.Charset.UTF_8) + '?=';
}

// Menu: the next family-only remembrance starts a fresh email thread.
function startNewFamilyThread() {
  var props = PropertiesService.getScriptProperties();
  var part = Number(props.getProperty('FAMILY_THREAD_PART') || '1');
  props.deleteProperty('FAMILY_THREAD_ID');
  props.deleteProperty('FAMILY_THREAD_ROOT');
  props.setProperty('FAMILY_THREAD_PART', String(part + 1));
  SpreadsheetApp.getUi().alert('The next family-only remembrance will start a new email thread.');
}

// Menu: send a test message into the family thread.
function sendFamilyThreadTest() {
  var ui = SpreadsheetApp.getUi();
  var to = familyEmails_();
  if (!to.length) { ui.alert('Add at least one email address to the Family tab first.'); return; }
  if (ui.alert('Send a test message to ' + to.length + ' address(es) in the Family tab, in the "' +
               FAMILY_THREAD_SUBJECT + '" thread?', ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  var res = sendToFamilyThread_({
    text: 'This is a test. Private remembrances shared through the website will arrive in this conversation.',
    name: SITE_NAME, email: '', when: new Date()
  });
  ui.alert(res + (typeof Gmail === 'undefined'
    ? '\n\nNote: the Gmail service isn\'t turned on, so messages are grouped by subject only. See setup.md.' : ''));
}

function publicRemembrances_() {
  var sheet = getRemSheet_();
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var rows = sheet.getRange(2, 1, last - 1, REM_HEADERS.length).getValues();
  var items = [];
  rows.forEach(function (r) {
    var shown = r[REM_COL.SHOW - 1] === true;
    var everyone = String(r[REM_COL.VISIBILITY - 1]).trim() === VIS_LABEL['public'];
    var text = String(r[REM_COL.TEXT - 1]).trim();
    if (shown && everyone && text) {
      var when = r[REM_COL.TIME - 1];
      items.push({
        name: String(r[REM_COL.NAME - 1]).trim(),
        text: text,
        date: when instanceof Date ? when.toISOString() : String(when)
      });
    }
  });
  return items.reverse(); // newest first
}

function isDuplicateRemembrance_(sheet, name, text) {
  var last = sheet.getLastRow();
  if (last < 2) return false;
  var start = Math.max(2, last - 49);
  var rows = sheet.getRange(start, REM_COL.NAME, last - start + 1, 2).getValues();
  return rows.some(function (r) {
    return String(r[0]).replace(/^'/, '') === name && String(r[1]).replace(/^'/, '') === text;
  });
}

function getRemSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(REM_SHEET_NAME) || ss.insertSheet(REM_SHEET_NAME);
  var first = sheet.getRange(1, 1, 1, REM_HEADERS.length);
  if (first.getValues()[0].join('') === '') {
    first.setValues([REM_HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.getRange('A:A').setNumberFormat('yyyy-mm-dd h:mm am/pm');
    sheet.setColumnWidth(REM_COL.TEXT, 480);
  }
  return sheet;
}


// ----- Sheet menu ---------------------------------------------------------

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu(SITE_NAME)
    .addItem('Send a test of a Gmail draft to me', 'menuSendTest')
    .addItem('Send a Gmail draft to everyone on the list', 'menuSendToList')
    .addSeparator()
    .addItem('Send a test to the family remembrance thread', 'sendFamilyThreadTest')
    .addItem('Start a new family remembrance thread', 'startNewFamilyThread')
    .addSeparator()
    .addItem('Set up the Subscribers, Remembrances and Family tabs', 'setupSheet')
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
  getRemSheet_();
  getFamilySheet_();
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

// Like clean_, but keeps line breaks so paragraphs survive.
function cleanText_(value, max) {
  return String(value == null ? '' : value)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim().slice(0, max);
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
