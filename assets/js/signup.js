/*
 * Sign-up form: sends name + email to the Google Apps Script web app
 * whose URL is set as `signup_endpoint` in _config.yml.
 */
(function () {
  "use strict";

  var form = document.querySelector("[data-signup]");
  if (!form) return;

  var endpoint = (form.getAttribute("data-endpoint") || "").trim();
  var statusEl = form.querySelector("[data-status]");
  var button = form.querySelector("button[type=submit]");
  var nameInput = form.elements.namedItem("name");
  var emailInput = form.elements.namedItem("email");
  var trap = form.elements.namedItem("website");
  var buttonLabel = button.textContent;
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function setStatus(msg, isError) {
    statusEl.textContent = msg;
    statusEl.classList.toggle("is-error", !!isError);
  }

  function markInvalid(input, bad) {
    if (bad) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
  }

  function firstName(full) {
    return full.split(/\s+/)[0];
  }

  function showThanks(name, status) {
    var p = document.createElement("p");
    p.className = "thanks";
    p.tabIndex = -1;
    p.textContent = status === "exists"
      ? "You're already on the list, " + firstName(name) + ". We'll be in touch when there's news."
      : "Thank you, " + firstName(name) + ". You're on the list, and we'll write when there's news.";
    form.replaceWith(p);
    p.focus();
  }

  function busy(on) {
    button.disabled = on;
    button.textContent = on ? "Adding you…" : buttonLabel;
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();

    var name = nameInput.value.trim().replace(/\s+/g, " ");
    var email = emailInput.value.trim();

    var nameBad = name.length === 0;
    var emailBad = !EMAIL_RE.test(email);
    markInvalid(nameInput, nameBad);
    markInvalid(emailInput, emailBad);
    if (nameBad) { setStatus("Enter your name.", true); nameInput.focus(); return; }
    if (emailBad) { setStatus("Enter an email address like name@example.com.", true); emailInput.focus(); return; }

    // Bots tend to fill every field; people never see this one.
    if (trap && trap.value) { showThanks(name, "added"); return; }

    if (!endpoint) {
      setStatus("The sign-up list isn't connected yet. Please check back soon.", true);
      return;
    }

    var body = new URLSearchParams({
      name: name,
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
        // The request was blocked before we could read a reply (some browsers and
        // privacy extensions do this with Google's redirect). Send it once more
        // without reading the reply; the sheet ignores duplicate emails.
        return fetch(endpoint, { method: "POST", mode: "no-cors", body: body })
          .then(function () { return { ok: true, status: "added" }; });
      })
      .then(function (data) {
        if (data && data.ok) {
          showThanks(name, data.status);
        } else {
          busy(false);
          setStatus((data && data.error) || "That didn't go through. Please try again.", true);
        }
      })
      .catch(function (err) {
        busy(false);
        setStatus(err && err.message === "bad-response"
          ? "The sign-up list isn't answering properly right now. Please try again later."
          : "We couldn't reach the sign-up list. Check your connection and try again.", true);
      });
  });

  [nameInput, emailInput].forEach(function (input) {
    input.addEventListener("input", function () {
      markInvalid(input, false);
      if (statusEl.classList.contains("is-error")) setStatus("");
    });
  });
})();
