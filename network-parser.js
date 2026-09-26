// Shared by the MAIN-world observer and fixture tests. Only public own-account
// fields leave this parser; request bodies, headers and credentials are not read.
(() => {
  const operations = new Set(['CreateTweet', 'CreateNoteTweet', 'CreateNoteTweetV2', 'UserByScreenName', 'UserByRestId', 'UserTweets', 'UserTweetsAndReplies', 'UserMedia', 'TweetDetail', 'HomeTimeline', 'HomeLatestTimeline']);
  function operation(url) {
    try {
      const u = new URL(url, 'https://x.com');
      if (!['x.com', 'www.x.com'].includes(u.hostname)) return null;
      const parts = u.pathname.match(/^\/i\/api\/graphql\/[^/]+\/([^/]+)$/);
      return parts && operations.has(parts[1]) ? parts[1] : null;
    } catch { return null; }
  }
  function unwrap(node) { return node?.__typename === 'TweetWithVisibilityResults' ? node.tweet : node; }
  function user(node) {
    if (!node || typeof node !== 'object') return null;
    const username = node.core?.screen_name || node.legacy?.screen_name;
    if (typeof username !== 'string' || !/^[a-z0-9_]{1,15}$/i.test(username)) return null;
    const count = node.legacy?.followers_count ?? node.public_metrics?.followers_count;
    return { username: username.toLowerCase(), followers: Number.isSafeInteger(count) && count >= 0 ? count : null,
      ...(typeof node.is_blue_verified === 'boolean' ? { blueVerified: node.is_blue_verified } : {}) };
  }
  function tweet(input) {
    const node = unwrap(input), legacy = node?.legacy;
    const owner = user(node?.core?.user_results?.result);
    const id = node?.rest_id || legacy?.id_str;
    const createdAt = legacy?.created_at;
    if (!legacy || !owner || typeof id !== 'string' || !/^\d{1,30}$/.test(id) || !Number.isFinite(Date.parse(createdAt))) return null;
    // A retweet wrapper is not an original post by the tracked account.
    if (legacy.retweeted_status_result || legacy.retweeted_status_id_str) return null;
    const edits = node.edit_control?.edit_tweet_ids || node.edit_control?.initial_tweet_id && [node.edit_control.initial_tweet_id, id];
    const edited = Array.isArray(edits) && edits.length > 1;
    const viewsRaw = node.views?.count ?? node.public_metrics?.impression_count;
    const views = typeof viewsRaw === 'string' && /^\d+$/.test(viewsRaw) ? Number(viewsRaw) : viewsRaw;
    return { id, username: owner.username, kind: legacy.in_reply_to_status_id_str ? 'replies' : 'posts', createdAt: new Date(createdAt).toISOString(), text: String(node.note_tweet?.note_tweet_results?.result?.text ?? legacy.full_text ?? '').slice(0, 500), edited: !!edited, views: Number.isSafeInteger(views) && views >= 0 ? views : null, approximate: false };
  }
  function parse(payload, op, username) {
    const result = { username, posts: [], followers: null, createdIds: [] };
    if (!operations.has(op) || !/^[a-z0-9_]{1,15}$/i.test(username) || !payload || typeof payload !== 'object') return result;
    const owner = username.toLowerCase(), found = new Map();
    function observeProfile(profile) {
      if (profile?.username !== owner) return;
      if (profile.followers !== null) result.followers = { value: profile.followers, approximate: false };
      if (typeof profile.blueVerified === 'boolean') result.blueVerified = profile.blueVerified;
    }
    const publish = /^Create(?:Note)?Tweet/.test(op);
    // Accept a publish only at its mutation result, never a nested quoted post.
    if (publish) {
      if (Array.isArray(payload.errors) && payload.errors.length) return result;
      const roots = ['create_tweet', 'create_note_tweet', 'create_note_tweet_v2'];
      for (const root of roots) {
        const raw = payload.data?.[root]?.tweet_results?.result;
        const item = tweet(raw);
        if (item?.username === owner && !item.edited) { found.set(item.id, item); result.createdIds.push(item.id); }
        const profile = user(unwrap(raw)?.core?.user_results?.result);
        observeProfile(profile);
      }
    } else {
      const stack = [payload]; let visited = 0;
      while (stack.length && visited++ < 40000) {
        const node = stack.pop(); if (!node || typeof node !== 'object') continue;
        const item = tweet(node);
        if (item?.username === owner && !item.edited) found.set(item.id, item);
        const profile = user(node);
        observeProfile(profile);
        for (const [key, value] of Object.entries(node)) {
          if (['quoted_status_result', 'retweeted_status_result', 'quoted_status', 'retweeted_status'].includes(key)) continue;
          if (value && typeof value === 'object') stack.push(value);
        }
      }
    }
    result.posts = [...found.values()].slice(0, 200);
    return result;
  }
  globalThis.XFocusNetwork = { operation, parse };
})();
