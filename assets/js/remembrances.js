/*
 * Remembrances: sends new remembrances to the Google Apps Script web app
 * (`signup_endpoint` in _config.yml) and lists the ones the family has
 * approved for everyone to see.
 */
(function () {
  "use strict";

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  // ---------- list ----------
  var list = document.querySelector("[data-list]");

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function formatDate(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return "";
    return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  }

  function setListMessage(msg) {
    list.innerHTML = "";
    var row = el("div", "row");
    row.appendChild(el("p", "col quiet", msg));
    list.appendChild(row);
  }

  function render(items) {
    list.innerHTML = "";
    if (!items.length) {
      setListMessage("No remembrances have been shared here yet.");
      return;
    }
    items.forEach(function (item) {
      var art = el("article", "remembrance row");
      var date = el("p", "gutter date");
      var t = el("time", null, formatDate(item.date));
      t.setAttribute("datetime", item.date);
      date.appendChild(t);
      var body = el("div", "col");
      String(item.text).split(/\n\s*\n/).forEach(function (para) {
        if (para.trim()) body.appendChild(el("p", null, para.trim()));
      });
      body.appendChild(el("p", "signature", item.name));
      art.appendChild(date);
      art.appendChild(body);
      list.appendChild(art);
    });
  }

  function load() {
    if (!list) return;
    var endpoint = (list.getAttribute("data-endpoint") || "").trim();
    if (!endpoint) { setListMessage("Remembrances aren't connected yet. Please check back soon."); return; }
    fetch(endpoint + (endpoint.indexOf("?") < 0 ? "?" : "&") + "action=remembrances")
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (!data || !data.ok || !Array.isArray(data.items)) throw new Error("bad");
        render(data.items);
      })
      .catch(function () {
        setListMessage("Remembrances couldn't be loaded right now. Please try again later.");
      });
  }

  load();

  // ---------- form ----------
  var form = document.querySelector("[data-remember]");
  if (!form) return;

  var endpoint = (form.getAttribute("data-endpoint") || "").trim();
  var statusEl = form.querySelector("[data-status]");
  var button = form.querySelector("button[type=submit]");
  var buttonLabel = button.textContent;
  var textInput = form.elements.namedItem("text");
  var nameInput = form.elements.namedItem("name");
  var emailInput = form.elements.namedItem("email");
  var trap = form.elements.namedItem("website");
  var thanks = document.querySelector("[data-thanks]");
  var thanksText = document.querySelector("[data-thanks-text]");
  var again = document.querySelector("[data-again]");

  function setStatus(msg, isError) {
    statusEl.textContent = msg;
    statusEl.classList.toggle("is-error", !!isError);
  }

  function markInvalid(input, bad) {
    if (bad) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
  }

  function busy(on) {
    button.disabled = on;
    button.textContent = on ? "Sharing…" : buttonLabel;
  }

  function visibility() {
    var checked = form.querySelector("input[name=visibility]:checked");
    return checked ? checked.value : "public";
  }

  function showThanks(name, vis) {
    var lead = "Thank you, " + name + (/[.!?]$/.test(name) ? " " : ". ");
    thanksText.textContent = lead + (vis === "family"
      ? "Your remembrance has been sent to Jane's family."
      : "The family will read your remembrance, and it will appear on this page soon.");
    form.hidden = true;
    thanks.hidden = false;
    thanksText.focus();
  }

  again.addEventListener("click", function () {
    form.reset();
    setStatus("");
    busy(false);
    thanks.hidden = true;
    form.hidden = false;
    textInput.focus();
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();

    var text = textInput.value.replace(/\r\n?/g, "\n").trim();
    var name = nameInput.value.trim().replace(/\s+/g, " ");
    var email = emailInput.value.trim();
    var vis = visibility();

    var textBad = text.length === 0;
    var nameBad = name.length === 0;
    var emailBad = email !== "" && !EMAIL_RE.test(email);
    markInvalid(textInput, textBad);
    markInvalid(nameInput, nameBad);
    markInvalid(emailInput, emailBad);
    if (textBad) { setStatus("Write your remembrance before sharing.", true); textInput.focus(); return; }
    if (nameBad) { setStatus("Enter how you'd like to sign it, for example Ann S.", true); nameInput.focus(); return; }
    if (emailBad) { setStatus("Check your email address, or leave it blank.", true); emailInput.focus(); return; }

    if (trap && trap.value) { showThanks(name, vis); return; }
    if (!endpoint) { setStatus("Remembrances aren't connected yet. Please check back soon.", true); return; }

    var body = new URLSearchParams({
      form: "remembrance",
      text: text,
      name: name,
      visibility: vis,
      email: email,
      website: "",
      page: location.pathname
    });

    busy(true);
    setStatus("");

    fetch(endpoint, { method: "POST", body: body })
      .then(function (res) {
        return res.json().then(
          function (data) { return data; },
          function () { throw new Error("bad-response"); }
        );
      }, function () {
        // Reply blocked (privacy extensions, Google's redirect); send without reading it.
        return fetch(endpoint, { method: "POST", mode: "no-cors", body: body })
          .then(function () { return { ok: true }; });
      })
      .then(function (data) {
        if (data && data.ok) {
          showThanks(name, vis);
        } else {
          busy(false);
          setStatus((data && data.error) || "That didn't go through. Please try again.", true);
        }
      })
      .catch(function (err) {
        busy(false);
        setStatus(err && err.message === "bad-response"
          ? "Remembrances aren't working properly right now. Your text is still here; please try again later."
          : "We couldn't send your remembrance. Check your connection and try again; your text is still here.", true);
      });
  });

  [textInput, nameInput, emailInput].forEach(function (input) {
    input.addEventListener("input", function () {
      markInvalid(input, false);
      if (statusEl.classList.contains("is-error")) setStatus("");
    });
  });
})();
