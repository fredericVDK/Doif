(() => {
  const nav = document.querySelector('.global-nav');
  if (!nav) return;

  const publicLinks = [
    ['/', 'Home'],
    ['/pigeondex.html', 'PigeonDex'],
    ['/pigder.html', 'Pigder'],
    ['/drawings.html', 'Drawings'],
    ['/api-docs.html', 'API']
  ];
  const signedInLinks = [
    ['/', 'Home'],
    ['/my-pigeon', 'My Pigeon'],
    ['/deck', 'Deck'],
    ['/race', 'Race'],
    ['/pigeondex.html', 'PigeonDex'],
    ['/shop', 'Shop'],
    ['/inventory', 'Inventory'],
    ['/profile', 'Profile']
  ];

  function currentPath() {
    return window.location.pathname === '/index.html' ? '/' : window.location.pathname;
  }

  function render(signedIn) {
    const links = signedIn ? signedInLinks : publicLinks;
    nav.replaceChildren(...links.map(([href, label]) => {
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.textContent = label;
      if (currentPath() === href) anchor.setAttribute('aria-current', 'page');
      return anchor;
    }));
    const accountLink = document.createElement('a');
    accountLink.href = signedIn ? '/logout' : '/sign-in';
    accountLink.textContent = signedIn ? 'Sign out' : 'Login';
    if (!signedIn) accountLink.className = 'login-link';
    nav.append(accountLink);
  }

  fetch('/api/auth/session', { credentials: 'same-origin' })
    .then(response => response.ok ? response.json() : null)
    .then(session => render(Boolean(session?.user)))
    .catch(() => render(false));
})();
