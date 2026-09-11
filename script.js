const form = document.querySelector('#intake-form');
const success = document.querySelector('#intake-success');
const errorBox = document.querySelector('#form-error');
const submitButton = form.querySelector('button[type="submit"]');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorBox.hidden = true;

  if (!form.reportValidity()) return;

  const payload = Object.fromEntries(new FormData(form));
  payload.idempotency_key = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  submitButton.disabled = true;
  form.classList.add('is-submitting');

  try {
    const response = await fetch('/api/intake', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const receipt = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(receipt.message || 'Request failed');
    document.querySelector('#intake-next-step').textContent = receipt.next_step || 'Check your email for testing instructions, complete one test, and send your feedback.';
    document.querySelector('#intake-duplicate-note').hidden = !receipt.duplicate;
    form.hidden = true;
    success.hidden = false;
    success.setAttribute('tabindex', '-1');
    success.focus?.();
  } catch (_) {
    errorBox.textContent = 'We could not queue your request right now. Please try again in a few minutes.';
    errorBox.hidden = false;
  } finally {
    submitButton.disabled = false;
    form.classList.remove('is-submitting');
  }
});

document.querySelector('#submit-another').addEventListener('click', () => {
  form.reset();
  success.hidden = true;
  document.querySelector('#intake-duplicate-note').hidden = true;
  form.hidden = false;
  form.querySelector('input').focus();
});

