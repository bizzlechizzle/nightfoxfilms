import { writable } from 'svelte/store';

export interface Route {
  path: string;
  params?: Record<string, string>;
  query?: Record<string, string>;
}

function createRouter() {
  const { subscribe, set } = writable<Route>({ path: '/dashboard' });

  // OPT-038: Store handler reference for cleanup
  let hashChangeHandler: (() => void) | null = null;

  function navigate(path: string, params?: Record<string, string>, query?: Record<string, string>) {
    let hash = path;
    if (query && Object.keys(query).length > 0) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value) searchParams.set(key, value);
      }
      const queryString = searchParams.toString();
      if (queryString) hash += '?' + queryString;
    }
    set({ path, params, query });
    window.location.hash = hash;
  }

  function parseRoute(hash: string): Route {
    // Split path from query string
    const [pathPart, queryPart] = (hash || '/dashboard').split('?');
    const path = pathPart;

    // Parse query parameters
    const query: Record<string, string> = {};
    if (queryPart) {
      const searchParams = new URLSearchParams(queryPart);
      searchParams.forEach((value, key) => {
        query[key] = value;
      });
    }

    // Sub-location route: /location/:locid/sub/:subid
    const subLocationMatch = path.match(/^\/location\/([^/]+)\/sub\/([^/]+)$/);
    if (subLocationMatch) {
      return {
        path: '/location/:locid/sub/:subid',
        params: { locid: subLocationMatch[1], subid: subLocationMatch[2] },
        query
      };
    }

    const locationMatch = path.match(/^\/location\/([^/]+)$/);
    if (locationMatch) {
      return {
        path: '/location/:id',
        params: { id: locationMatch[1] },
        query
      };
    }

    const projectMatch = path.match(/^\/project\/([^/]+)$/);
    if (projectMatch) {
      return {
        path: '/project/:id',
        params: { id: projectMatch[1] },
        query
      };
    }

    return { path, query };
  }

  function init() {
    const hash = window.location.hash.slice(1);
    set(parseRoute(hash));

    // OPT-038: Store handler reference so it can be removed on destroy
    hashChangeHandler = () => {
      const newHash = window.location.hash.slice(1);
      set(parseRoute(newHash));
    };
    window.addEventListener('hashchange', hashChangeHandler);
  }

  /**
   * OPT-038: Cleanup function to remove hashchange listener
   * Call this if the app is unmounted (e.g., in embedded contexts)
   */
  function destroy() {
    if (hashChangeHandler) {
      window.removeEventListener('hashchange', hashChangeHandler);
      hashChangeHandler = null;
    }
  }

  return {
    subscribe,
    navigate,
    init,
    destroy
  };
}

export const router = createRouter();
