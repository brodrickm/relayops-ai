const form = document.querySelector('#intake-form');
const success = document.querySelector('#intake-success');
const errorBox = document.querySelector('#form-error');
const submitButton = form.querySelector('button[type="submit"]');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorBox.hidden = true;

  if (!form.reportValidity()) return;

  const payload = Object.fromEntries(new FormData(form));
  submitButton.disabled = true;
  form.classList.add('is-submitting');

  try {
    const response = await fetch('/api/intake', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) throw new Error('Request failed');
    form.hidden = true;
    success.hidden = false;
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
  form.hidden = false;
  form.querySelector('input').focus();
});

