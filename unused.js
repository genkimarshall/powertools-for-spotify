/*
  The code below shows another way we could upload the sorted playlist:
    Simply clear the upstream playlist and then add the sorted tracks!
  This could result in up to 100x faster sorting...
  However, there are two downsides:
    1. It loses the metadata of when the track was added to the playlist.
    2. If there were a code or network error in the middle of running,
      the playlist could be left in an empty or only partially-refilled state.
      This would mean adding in lots of warnings to backup the user's playlists.
      Also, making error-handling significantly more robust/stressful.
  Of course, the real solution here is if Spotify can make their API give us
    an option with the best of both worlds. See for more discussion:
    https://community.spotify.com/t5/Spotify-for-Developers/Reorder-an-entire-playlist-with-one-call-rather-than-per-song/m-p/5286769/
*/

function clearPlaylist(playlistId, onDone) {
  apiCall('playlists/' + playlistId + '/tracks?uris=', onDone, 'PUT');
}

function addToPlaylist(playlistId, offset, onDone) {
  const tracks = globals.playlistIdToTracks.get(playlistId);
  if (offset >= tracks.length)
    return onDone();
  const params = { 'uris': tracks.slice(offset, offset + 100).map(x => x.uri) };
  params.toString = function () { return '{idx:' + offset + '}'};
  apiCall('playlists/' + playlistId + '/tracks', function () {
    return addToPlaylist(playlistId, offset + 100, onDone);
  }, 'POST', params);
}
