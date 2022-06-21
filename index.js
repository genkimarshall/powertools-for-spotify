const OAUTH_CLIENT_ID = 'ded2d2a4b2374aa08e016c0b51c9b2e1'; // Only authorized for hosted instance (see README.md).

const OAUTH_SCOPE = 'user-library-read playlist-read-collaborative playlist-read-private playlist-modify-public playlist-modify-private';
const OAUTH_STATE_KEY = 'OAUTH_STATE';
const SPOTIFY_OPEN_URL = 'https://open.spotify.com';

const LIKED_ID = 'liked';
const TRACK_AND_BUTTON = 'Track <button onclick="createPlaylistFromResults()">Create Playlist</button>';

const API_MAXES = Object.freeze({
  'me/playlists': 50,
  'me/tracks': 50,
  'playlists/tracks': 100,
});

const TIME_SPANS = Object.freeze({
  '1day': 1,
  '1week': 7,
  '2week': 14,
  '4week': 28,
});

const RESULT_HEADERS = Object.freeze({
  'optRunShowDuplicateEach': [TRACK_AND_BUTTON, 'Playlist', 'Count'],
  'optRunShowDuplicateSum': [TRACK_AND_BUTTON, 'Playlists'],
  'optRunShowDuplicateFuzzy': ['Track A', 'Release A', 'Playlist A', 'Track B', 'Release B', 'Playlist B'],
  'optRunShowUniqueEach': [TRACK_AND_BUTTON, 'Playlist'],
  'optRunShowUniqueSum': [TRACK_AND_BUTTON, 'Unique to Playlists'],
  'optRunShowRecentlyAdded': [TRACK_AND_BUTTON, 'Added At'],
  'optRunSearch': [TRACK_AND_BUTTON, 'Playlist'],
  'optRunSortTracksA': ['Sorted Playlists'],
  'optRunSortTracksB': ['Sorted Playlists'],
});

const globals = {
  'oAuthAccessToken': undefined,
  'userId': undefined,
  'userDisplayName': undefined,
  'playlistIdToMetadata': new Map(), // PlaylistID -> Playlist
  'playlistIdToEntries': new Map(),  // PlaylistID -> Array(Entry)
    // where:
    // PlaylistID is the Spotify API playlist ID (string), or LIKED_ID.
    // Playlist   is the Spotify API playlist object.
    // Entry      is the Spotify API playlist entry object, with additional field xUpstreamIdx.
};

/* GENERAL */

function cmp(a, b) {
  if (a < b)
    return -1;
  return a > b ? 1 : 0;
}

function pseudoRandomString() {
  return window.btoa(Math.random());
}

function getBaseUrl() {
  return window.location.origin + window.location.pathname;
}

/* HTML */

function gebi(id) {
  return document.getElementById(id);
}

function resetApp() {
  window.location.href = getBaseUrl();
  gebi('divSplash').style.display = '';
  gebi('divApp').style.display = 'none';
}

function updateStatus(html) {
  gebi('divStatus').innerHTML = html;
}

function addResult(columns) {
  const tr = document.createElement('tr');
  for (const column of columns) {
    const td = document.createElement('td');
    td.innerHTML = column;
    tr.appendChild(td);
  }
  gebi('tbodyResults').appendChild(tr);
}

function spotifyLink(base, id, text) {
  const uri = (base === 'playlist' && id === LIKED_ID) ?
    (SPOTIFY_OPEN_URL + '/collection/tracks') :
    (SPOTIFY_OPEN_URL + '/' + base + '/' + id);
  return '<a class="spotifyLink" target="_blank" href="' + uri + '">' + text + '</a>';
}

function spotifyLinkPlaylist(playlistId) {
  return spotifyLink('playlist', playlistId,
    globals.playlistIdToMetadata.get(playlistId).name);
}

function spotifyLinkTrack(track) {
  return spotifyLink('track', track.id,
    track.artists.map(x => x.name).join(' & ') + ' - ' + track.name);
}

function spotifyLinkRelease(track) {
  return spotifyLink('album', track.album.id, track.album.name) +
    ' (' + track.album.album_type + ')';
}

function trackHrefToUri(href) {
  return 'spotify:track:' + href.substring((SPOTIFY_OPEN_URL + '/track/').length);
}

function getPlaylistCheckboxes() {
  return Array.from(gebi('tbodyPlaylists').getElementsByTagName('input'));
}

function getSelectedPlaylistIds() {
  return getPlaylistCheckboxes().filter(x => x.checked).map(x => x.id);
}

function getNumSelectedPlaylists() {
  return getPlaylistCheckboxes().filter(x => x.checked).length;
}

function onCheckboxPlaylistsToggleAll(event) {
  const changeTo = gebi('checkboxPlaylistsToggleAll').checked;
  for (const checkbox of getPlaylistCheckboxes())
    checkbox.checked = changeTo;
  event.stopPropagation();
}

function addPlaylistRow(playlistMetadata) {
  const tr = document.createElement('tr');
  let td;

  const checkbox = document.createElement('input');
  checkbox.setAttribute('type', 'checkbox');
  checkbox.setAttribute('id', playlistMetadata.id);
  td = document.createElement('td');
  td.appendChild(checkbox);
  tr.appendChild(td);

  const label = document.createElement('label');
  label.innerHTML = spotifyLinkPlaylist(playlistMetadata.id);
  label.setAttribute('for', playlistMetadata.id);
  td = document.createElement('td');
  td.appendChild(label);
  tr.appendChild(td);

  for (const html of [
      spotifyLink('user', playlistMetadata.owner.id, playlistMetadata.owner.display_name),
      playlistMetadata.tracks.total,
      playlistMetadata.public ? '✓' : '',
      playlistMetadata.collaborative ? '✓' : '',
    ]) {
    td = document.createElement('td');
    td.innerHTML = html;
    tr.appendChild(td);
  }

  gebi('tbodyPlaylists').appendChild(tr);
}

function clearResults() {
  for (const id of ['theadtrResults', 'tbodyResults']) {
    const el = gebi(id);
    while (el.firstChild)
      el.removeChild(el.firstChild);
  }
}

function setupResultsTable(action) {
  if (gebi('tableResults').getBoundingClientRect().y > window.innerHeight)
    gebi('theadPlaylists').click();
  clearResults();
  const theadtr = gebi('theadtrResults');
  for (const header of RESULT_HEADERS[action]) {
    const th = document.createElement('th');
    th.innerHTML = header;
    theadtr.appendChild(th);
  }
  gebi('headerResults').style.display = '';
}

/* SPOTIFY DATA STRUCTURES */

function makeLikedSongsMetadata(numLikedSongs) {
  return {
    'id': LIKED_ID,
    'name': 'Liked Songs',
    'tracks': { 'total': numLikedSongs },
    'owner': {
      'display_name': globals.userDisplayName,
      'id': globals.userId,
    },
    'private': true,
    'collaborative': false,
  };
}

function entriesIncludes(entries, idQuery) {
  for (const entry of entries)
    if (entry.track.id === idQuery)
      return true;
}

function artistsIncludes(track, nameQuery) {
  for (const artist of track.artists)
    if (artist.name.toLowerCase().includes(nameQuery))
      return true;
  return false;
}

function albumArtistsForSorting(track) {
  return track.album.artists.map(function (x) {
    let name = x.name.toLowerCase();
    if (name.startsWith('the '))
      return name.substring(4);
    return name;
  }).join(',');
}

function makeCmpEntryFunc(artistFirst) {
  return function (a, b) {
    [a, b] = [a.track, b.track];
    const [aArtists, bArtists] = [albumArtistsForSorting(a), albumArtistsForSorting(b)];
    if (artistFirst) {
      if (aArtists !== bArtists)
        return cmp(aArtists, bArtists);
      else if (a.album.release_date !== b.album.release_date)
        return cmp(a.album.release_date, b.album.release_date);
    } else {
      if (a.album.release_date !== b.album.release_date)
        return cmp(b.album.release_date, a.album.release_date); // Reverse.
      else if (aArtists !== bArtists)
        return cmp(aArtists, bArtists);
    }
    if (a.album.name !== b.album.name)
      return cmp(a.album.name, b.album.name);
    else if (a.disc_number !== b.disc_number)
      return cmp(a.disc_number, b.disc_number);
    else if (a.track_number !== b.track_number)
      return cmp(a.track_number, b.track_number);
    else
      return 0;
  }
}

function fuzzyMatches(track, otherTrack) {
  if (track.id === otherTrack.id)
    return false;
  if (track.external_ids.isrc !== undefined &&
      track.external_ids.isrc === otherTrack.external_ids.isrc)
    return true;
  if (track.name === otherTrack.name &&
      track.artists.map(x => x.name).join(',') === otherTrack.artists.map(x => x.name).join(','))
    return true;
  return false;
}


/* SPOTIFY API */

function oAuth() {
  const expectedRespState = pseudoRandomString(); // Not crypto-secure but apparently that's OK...
  window.localStorage.setItem(OAUTH_STATE_KEY, expectedRespState);
  window.location.href = 'https://accounts.spotify.com/authorize?' + [
      'client_id=' + OAUTH_CLIENT_ID,
      'redirect_uri=' + getBaseUrl(),
      'response_type=token',
      'scope=' + OAUTH_SCOPE,
      'state=' + expectedRespState,
    ].join('&');
}

function apiCall(resource, callback, method='GET', queryParams=undefined) {
  const queryParamsString = queryParams === undefined ? '' : (' params=' + queryParams.toString());
  updateStatus('calling Spotify API... (' + method + ' ' + resource + queryParamsString + ')');
  let req = new XMLHttpRequest();
  req.addEventListener('error', function () {
    throw new Error('NETWORK ERROR: On request of "' + resource + '".');
  });
  req.addEventListener('load', function () {
    const resp = JSON.parse(this.responseText);
    // Note: XMLHttpRequest handles 304 (Not Modified) by giving us 200 with duplicated data.
    if ([200, 201, 202, 204].includes(this.status)) {
      updateStatus('');
      return callback(resp);
    } else if (this.status === 400) {
      throw new Error('BUG: Bad API request ("' + resp.error.message + '").');
    } else if (this.status === 401) {
      alert('Bad or expired token ("' + resp.error.message + '"), resetting application...');
      resetApp();
    } else if (this.status === 403) {
      throw new Error('BUG: Bad OAuth request ("' + resp.error.message + '").');
    } else if (this.status === 429) {
      alert('Application has exceeded rate limit. Please wait a few minutes and refresh the page.');
      throw new Error();
    } else if (this.status === 503) {
      alert('Spotify API returned 503 Service Unavailable. Please wait a few minutes and refresh the page.');
      throw new Error();
    } else {
      throw new Error(this.status + ' status on request of "' + resource + '".');
    }
  });
  req.open(method, 'https://api.spotify.com/v1/' + resource);
  req.setRequestHeader('Authorization', 'Bearer ' + globals.oAuthAccessToken);
  req.send(JSON.stringify(queryParams));
};

function loadPlaylistList(onDone) {
  apiCall('me/playlists?limit=' + API_MAXES['me/playlists'] +
          '&offset=' + globals.playlistIdToEntries.size,
    function (resp) {
      for (const playlist of resp.items) {
        globals.playlistIdToMetadata.set(playlist.id, playlist);
        globals.playlistIdToEntries.set(playlist.id, []);
      }
      if (resp.next === null)
        return onDone();
      return loadPlaylistList(onDone);
    });
}

function loadLikedTracks(onDone) {
  apiCall('me/tracks?limit=' + API_MAXES['me/tracks'] + '&offset=' +
          globals.playlistIdToEntries.get(LIKED_ID).length,
    function (resp) {
      for (const entry of resp.items)
        globals.playlistIdToEntries.get(LIKED_ID).push(entry);
      if (resp.next === null)
        return onDone();
      return loadLikedTracks(onDone);
    });
}

function loadPlaylist(playlistId, onDone) {
  if (playlistId === LIKED_ID)
    return loadLikedTracks(onDone);
  const numAlreadyLoaded = globals.playlistIdToEntries.get(playlistId).length;
  const getFirstPage = numAlreadyLoaded === 0;
  const resource = getFirstPage ?
    ('playlists/' + playlistId + '?additional_types=track') :
    ('playlists/' + playlistId +
      '/tracks?additional_types=track&limit=' + API_MAXES['playlists/tracks'] +
      '&offset=' + numAlreadyLoaded);
  apiCall(resource,
    function (resp) {
      if (getFirstPage)
        globals.playlistIdToMetadata.set(playlistId, resp);
      const newTracks = getFirstPage ? resp.tracks.items : resp.items;
      for (const [idx, entry] of newTracks.entries()) {
        entry.xUpstreamIdx = numAlreadyLoaded + idx;
        globals.playlistIdToEntries.get(playlistId).push(entry);
      }
      const next = getFirstPage ? resp.tracks.next : resp.next;
      if (next === null)
        return onDone();
      return loadPlaylist(playlistId, onDone);
    });
}

function loadPlaylists(playlistIter, onDone) {
  const next = playlistIter.next();
  if (next.done)
    return onDone();
  const playlistId = next.value;
  globals.playlistIdToEntries.set(playlistId, []);
  loadPlaylist(playlistId, function () {
    return loadPlaylists(playlistIter, onDone);
  });
}

function sortUpstreamPlaylist(playlistId, newIdx, onDone) {
  const entries = globals.playlistIdToEntries.get(playlistId);
  while (newIdx < entries.length && newIdx === entries[newIdx].xUpstreamIdx)
    newIdx += 1; // Optimization: Skip no-ops.
  if (newIdx === entries.length)
    return onDone();
  const oldIdx = entries[newIdx].xUpstreamIdx;
  const params = {
    'range_start': oldIdx,
    'insert_before': newIdx,
    'snapshot_id': globals.playlistIdToMetadata.get(playlistId).snapshot_id,
  };
  params.toString = function () { return '{idx:' + newIdx + '}'; };
  apiCall('playlists/' + playlistId + '/tracks', function (res) {
    globals.playlistIdToMetadata.get(playlistId).snapshot_id = res.snapshot_id;
    for (const entry of entries)
      if (entry.xUpstreamIdx >= newIdx && entry.xUpstreamIdx < oldIdx)
        entry.xUpstreamIdx += 1;
    entries[newIdx].xUpstreamIdx = newIdx;
    return sortUpstreamPlaylist(playlistId, newIdx + 1, onDone);
  }, 'PUT', params);
}

function sortUpstreamPlaylists(playlistIter) {
  const next = playlistIter.next();
  if (next.done)
    return;
  const currPlaylistId = next.value;
  sortUpstreamPlaylist(currPlaylistId, 0, function () {
    addResult([spotifyLinkPlaylist(currPlaylistId)]);
    return sortUpstreamPlaylists(playlistIter);
  });
}

function addToPlaylist(playlistId, trackUris, numDone, onDone) {
  const numToUpload = Math.min(API_MAXES['playlists/tracks'], trackUris.length - numDone);
  if (numToUpload === 0)
    return onDone();
  const params = { 'uris': trackUris.slice(numDone, numToUpload) };
  params.toString = function () { return numDone + ':' + (numDone + numToUpload); };
  apiCall('playlists/' + playlistId + '/tracks', function (_) {
    return addToPlaylist(playlistId, trackUris, numDone + numToUpload, onDone);
  }, 'POST', params);
}

function createPlaylist(trackUris) {
  const time = new Intl.DateTimeFormat('default', { 'hour': 'numeric', 'minute': 'numeric' }).format(new Date());
  const playlistName = 'Via Powertools (' + time + ')';
  const params = {
    'name': playlistName,
    'description': 'Created by ' + getBaseUrl(),
  };
  params.toString = function () { return params.name; };
  apiCall('users/' + globals.userId + '/playlists', function (playlist) {
    addToPlaylist(playlist.id, trackUris, 0, function () {
      updateStatus('Created playlist: ' + spotifyLink('playlist', playlist.id, playlist.name) + '.');
    });
  }, 'POST', params);
}

/* BUTTON ACTIONS */

function onBtnRunShowDuplicateEach(selectedPlaylistIds) {
  loadPlaylists(selectedPlaylistIds.values(), function () {
    for (const playlistId of selectedPlaylistIds) {
      const metadata = new Map();
      const appearances = new Map();
      for (const entry of globals.playlistIdToEntries.get(playlistId)) {
        const track = entry.track;
        metadata.set(track.id, track);
        if (!appearances.has(track.id))
          appearances.set(track.id, 0);
        appearances.set(track.id, appearances.get(track.id) + 1);
      }
      for (const [trackId, count] of appearances)
        if (count > 1)
          addResult([spotifyLinkTrack(metadata.get(trackId)),
            spotifyLinkPlaylist(playlistId), count]);
    }
  });
}

function onBtnRunShowDuplicateSum(selectedPlaylistIds) {
  loadPlaylists(selectedPlaylistIds.values(), function () {
    const metadata = new Map();
    const appearances = new Map();
    for (const playlistId of selectedPlaylistIds) {
      for (const entry of globals.playlistIdToEntries.get(playlistId)) {
        const track = entry.track;
        metadata.set(track.id, track);
        if (!appearances.has(track.id))
          appearances.set(track.id, new Set());
        appearances.get(track.id).add(playlistId);
      }
    }
    for (const [trackId, playlists] of appearances)
      if (playlists.size > 1)
        addResult([spotifyLinkTrack(metadata.get(trackId)),
          Array.from(playlists).map(x => spotifyLinkPlaylist(x)).join(' & ')]);
  });
}

function onBtnRunShowDuplicateFuzzy(selectedPlaylistIds) {
  loadPlaylists(selectedPlaylistIds.values(), function () {
    const otherPlaylistIds = new Set(selectedPlaylistIds);
    for (const playlistId of selectedPlaylistIds) {
      const withinPlaylist = new Map();
      for (const entry of globals.playlistIdToEntries.get(playlistId)) {
        const track = entry.track;
        for (const otherPlaylistId of otherPlaylistIds) {
          for (const otherEntry of globals.playlistIdToEntries.get(otherPlaylistId)) {
            const otherTrack = otherEntry.track;
            if (!fuzzyMatches(track, otherTrack))
              continue;
            if (playlistId === otherPlaylistId) {
              if (withinPlaylist.has(otherTrack.id) &&
                  withinPlaylist.get(otherTrack.id).has(track.id))
                continue;
              if (!withinPlaylist.has(track.id))
                withinPlaylist.set(track.id, new Set());
              withinPlaylist.get(track.id).add(otherTrack.id);
            }
            addResult([
              spotifyLinkTrack(track), spotifyLinkRelease(track), spotifyLinkPlaylist(playlistId),
              spotifyLinkTrack(otherTrack), spotifyLinkRelease(otherTrack), spotifyLinkPlaylist(otherPlaylistId)]);
          }
        }
      }
      otherPlaylistIds.delete(playlistId);
    }
  });
}

function onBtnRunShowUniqueEach(selectedPlaylistIds) {
  loadPlaylists(globals.playlistIdToMetadata.keys(), function () {
    for (const playlistId of selectedPlaylistIds) {
      for (const entry of globals.playlistIdToEntries.get(playlistId)) {
        const track = entry.track;
        let foundInOther = false;
        for (const [otherPlaylistId, otherEntries] of globals.playlistIdToEntries) {
          if (otherPlaylistId === playlistId)
            continue;
          if (entriesIncludes(otherEntries, track.id)) {
            foundInOther = true;
            break;
          }
        }
        if (!foundInOther)
          addResult([spotifyLinkTrack(track), spotifyLinkPlaylist(playlistId)]);
      }
    }
  });
}

function onBtnRunShowUniqueSum(selectedPlaylistIds) {
  loadPlaylists(globals.playlistIdToMetadata.keys(), function () {
    const trackIdToPlaylists = new Map();
    const metadata = new Map();
    for (const [playlistId, entries] of globals.playlistIdToEntries) {
      const inSelected = selectedPlaylistIds.includes(playlistId);
      for (const entry of entries) {
        const track = entry.track;
        if (!inSelected) {
          trackIdToPlaylists.set(track.id, null);
        } else if (trackIdToPlaylists.get(track.id) !== null) {
          if (!trackIdToPlaylists.has(track.id))
            trackIdToPlaylists.set(track.id, []);
          trackIdToPlaylists.get(track.id).push(playlistId);
          metadata.set(track.id, track);
        }
      }
    }
    for (const [trackId, playlistIds] of trackIdToPlaylists)
      if (playlistIds !== null)
        addResult([spotifyLinkTrack(metadata.get(trackId)),
          playlistIds.map(x => spotifyLinkPlaylist(x)).join(', ')]);
  });
}

function onBtnRunShowRecentlyAdded(selectedPlaylistIds) {
  const choice = gebi('selectRecentlyAddedFilter').value;
  if (choice === '')
    return alert('Please select a filter for recently-added tracks.');
  loadPlaylists(selectedPlaylistIds.values(), function () {
    let entries = selectedPlaylistIds.map(x => globals.playlistIdToEntries.get(x)).flat().sort(
      (a, b) => cmp(new Date(b.added_at), new Date(a.added_at)));
    if (choice in TIME_SPANS) {
      const lowerLimit = new Date();
      lowerLimit.setDate(lowerLimit.getDate() - TIME_SPANS[choice]);
      entries = entries.filter(x => new Date(x.added_at) >= lowerLimit);
    } else {
      entries = entries.slice(0, parseInt(choice));
    }
    for (const entry of entries)
      addResult([spotifyLinkTrack(entry.track), new Date(entry.added_at).toLocaleString()]);
  });
}

function onBtnRunSearch(selectedPlaylistIds) {
  const query = gebi('inputSearch').value.toLowerCase();
  loadPlaylists(selectedPlaylistIds.values(), function () {
    for (const playlistId of selectedPlaylistIds)
      for (const entry of globals.playlistIdToEntries.get(playlistId))
        if (entry.track.name.toLowerCase().includes(query) ||
            artistsIncludes(entry.track, query))
          addResult([spotifyLinkTrack(entry.track), spotifyLinkPlaylist(playlistId)]);
  });
}

function makeOnBtnRunSortTracksHandler(sortArtistsFirst) {
  return function (selectedPlaylistIds) {
    for (const playlistId of selectedPlaylistIds) {
      if (playlistId === LIKED_ID)
        return alert('You cannot sort your Liked Songs. Please uncheck it.');
      const metadata = globals.playlistIdToMetadata.get(playlistId);
      if (!metadata.collaborative && metadata.owner.id !== globals.userId)
        return alert('You cannot sort "' + metadata.name + '" because you do not own it'
          + ' and it is not collaborative. Please uncheck it.');
    }
    loadPlaylists(selectedPlaylistIds.values(), function () {
      for (const playlistId of selectedPlaylistIds)
        globals.playlistIdToEntries.get(playlistId).sort(makeCmpEntryFunc(sortArtistsFirst));
      sortUpstreamPlaylists(selectedPlaylistIds.values(), function () {});
    });
  }
}

function createPlaylistFromResults() {
  const trackUris = Array.from(gebi('tbodyResults').getElementsByTagName('a'))
    .filter(x => x.href.includes(SPOTIFY_OPEN_URL + '/track/'))
    .map(x => trackHrefToUri(x.href));
  createPlaylist(trackUris);
}

function setupAppButtons() {
  gebi('checkboxPlaylistsToggleAll').onclick = onCheckboxPlaylistsToggleAll;

  gebi('theadPlaylists').onclick = function () {
    gebi('tablePlaylists').style.display = 'none';
    const btnShow = gebi('btnPlaylistsShow');
    btnShow.innerText =
      'Show Playlists (' + getNumSelectedPlaylists() + ' selected)';
      btnShow.style.display = '';
  }

  gebi('btnPlaylistsShow').onclick = function () {
    gebi('tablePlaylists').style.display = '';
    this.style.display = 'none';
  };

  gebi('selectRun').onchange = function () {
    if (this.value === 'optRunShowRecentlyAdded') {
      gebi('inputSearch').style.display = 'none';
      gebi('selectRecentlyAddedFilter').style.display = '';
    } else if (this.value === 'optRunSearch') {
      gebi('inputSearch').style.display = '';
      gebi('selectRecentlyAddedFilter').style.display = 'none';
    } else {
      gebi('inputSearch').style.display = 'none';
      gebi('selectRecentlyAddedFilter').style.display = 'none';
    }
  }

  gebi('btnRun').onclick = function () {
    const selectedPlaylistIds = getSelectedPlaylistIds();
    if (selectedPlaylistIds.length === 0)
      return alert('Please select 1 or more playlists to work off of.');
    const map = {
      'optRunShowDuplicateEach': onBtnRunShowDuplicateEach,
      'optRunShowDuplicateSum': onBtnRunShowDuplicateSum,
      'optRunShowDuplicateFuzzy': onBtnRunShowDuplicateFuzzy,
      'optRunShowUniqueEach': onBtnRunShowUniqueEach,
      'optRunShowUniqueSum': onBtnRunShowUniqueSum,
      'optRunShowRecentlyAdded': onBtnRunShowRecentlyAdded,
      'optRunSearch': onBtnRunSearch,
      'optRunSortTracksA': makeOnBtnRunSortTracksHandler(true),
      'optRunSortTracksB': makeOnBtnRunSortTracksHandler(false),
    };
    const opt = gebi('selectRun').value;
    setupResultsTable(opt);
    map[opt](selectedPlaylistIds);
  };
}

/* MAIN */

function loadApp() {
  apiCall('me', function (resp) {
    globals.userId = resp.id;
    globals.userDisplayName = resp.display_name;
    apiCall('me/tracks', function (resp) {
      globals.playlistIdToMetadata.set(LIKED_ID, makeLikedSongsMetadata(resp.total));
      loadPlaylistList(function () {
        gebi('headerLoggedInAs').innerHTML =
          spotifyLink('user', globals.userId, globals.userDisplayName) + '\'s collection';
        for (const playlistMetadata of globals.playlistIdToMetadata.values())
          addPlaylistRow(playlistMetadata);
        setupAppButtons();
        gebi('divSplash').style.display = 'none';
        gebi('divApp').style.display = '';
      });
    });
  });
}

function main() {
  window.onerror = function () {
    alert('There has been an error, please open the JavaScript console '
      + '(probably: Close this popup -> Right click page -> Inspect Element -> click the "Console" tab)'
      + ' and send a screenshot to me!')
    return false; // Run default Error handling.
  }

  if (window.location.hash === '') {
    gebi('btnStart').onclick = oAuth;
    return;
  }

  const urlParams = new URLSearchParams(window.location.hash.substring(1));

  const oAuthState = urlParams.get('state');
  if (oAuthState !== window.localStorage.getItem(OAUTH_STATE_KEY))
    throw new Error('Auth: State mismatch.');

  const oAuthError = urlParams.get('error');
  if (oAuthError !== null)
    throw new Error('Auth: ' + oAuthError + '.');

  globals.oAuthAccessToken = urlParams.get('access_token');
  loadApp();
}

document.addEventListener('DOMContentLoaded', main);
