// Apply the stored theme before styles load. The demo's checking logic stays in app.js.
;(() => {
  const root = document.documentElement
  const key = 'ctxharness.theme'
  const allowed = new Set(['light', 'dark', 'system'])
  const system = window.matchMedia('(prefers-color-scheme: dark)')
  let choice = 'light'
  try {
    const stored = localStorage.getItem(key)
    if (allowed.has(stored)) choice = stored
  } catch { /* Storage may be unavailable in private or embedded contexts. */ }
  root.classList.add('has-js')
  const apply = () => {
    root.dataset.theme = choice === 'system' ? (system.matches ? 'dark' : 'light') : choice
    document.querySelectorAll('[data-theme-choice]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.themeChoice === choice))
    })
    const current = document.querySelector('.theme-current')
    if (current) current.textContent = choice[0].toUpperCase() + choice.slice(1)
  }
  apply()
  system.addEventListener('change', () => { if (choice === 'system') apply() })
  window.addEventListener('storage', event => {
    if (event.key !== key && event.key !== null) return
    choice = allowed.has(event.newValue) ? event.newValue : 'light'
    apply()
  })
  document.addEventListener('DOMContentLoaded', () => {
    apply()
    const picker = document.querySelector('.theme-picker')
    const toggle = document.querySelector('#menu-toggle')
    const navigation = document.querySelector('#site-navigation')
    const header = document.querySelector('.site-header')
    const desktop = window.matchMedia('(min-width: 1100px)')
    const setMenu = open => {
      toggle.setAttribute('aria-expanded', String(open))
      header.dataset.menuOpen = String(open)
    }
    setMenu(false)
    toggle.addEventListener('click', () => {
      picker.open = false
      setMenu(toggle.getAttribute('aria-expanded') !== 'true')
    })
    navigation.addEventListener('click', event => {
      if (event.target.closest('a')) setMenu(false)
    })
    desktop.addEventListener('change', () => setMenu(false))
    picker.addEventListener('toggle', () => { if (picker.open) setMenu(false) })
    picker.querySelectorAll('[data-theme-choice]').forEach(button => {
      button.addEventListener('click', () => {
        choice = button.dataset.themeChoice
        try { localStorage.setItem(key, choice) } catch { /* Keep the in-memory choice. */ }
        apply()
        picker.open = false
        picker.querySelector('summary').focus()
      })
    })
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return
      if (picker.open) {
        picker.open = false
        picker.querySelector('summary').focus()
      } else if (toggle.getAttribute('aria-expanded') === 'true') {
        setMenu(false)
        toggle.focus()
      }
    })
    document.addEventListener('click', event => {
      if (!picker.contains(event.target)) picker.open = false
    })
  })
})()
