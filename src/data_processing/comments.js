import {
  getComments as getRedditComments,
  getItems as getRedditItems,
  getModerators, getSubredditAbout,
  getModlogsComments, oauth_reddit
} from 'api/reddit'
import {
  getPostsByIDForCommentData as getPushshiftPostsForCommentData,
  getCommentsBySubreddit as pushshiftGetCommentsBySubreddit
} from 'api/pushshift'
import { commentIsDeleted, commentIsRemoved, postIsDeleted, isEmptyObj } from 'utils'
import { AUTOMOD_REMOVED, AUTOMOD_REMOVED_MOD_APPROVED, MOD_OR_AUTOMOD_REMOVED,
         UNKNOWN_REMOVED, NOT_REMOVED,
         AUTOMOD_LATENCY_THRESHOLD } from 'pages/common/RemovedBy'
import { combinedGetItemsBySubredditOrDomain } from 'data_processing/subreddit_posts'

export let useProxy = false

export const retrieveRedditComments_and_combineWithPushshiftComments = (pushshiftComments) => {
  return getRedditComments({objects: pushshiftComments, useProxy})
  .then(redditComments => {
    return combinePushshiftAndRedditComments(pushshiftComments, redditComments)
  })
}

const copy_fields = ['permalink', 'score', 'controversiality',
                     'locked', 'collapsed', 'edited',
                     'subreddit_subscribers', 'quarantine', 'url',
                     'link_title',
                     // below fields added for modlog comments that may not appear in pushshift yet
                     // and were added to the pushshiftComments object
                     'subreddit', 'created_utc', 'parent_id']

const copy_if_value_fields = ['distinguished', 'stickied', 'author_fullname']

export const initializeComment = (comment, post) => {
  if (post && post.author === comment.author && comment.author !== '[deleted]') {
    comment.is_op = true
  }
  comment.replies = []
  comment.ancestors = {}
}

const markRemoved = (redditComment, commentToMark, is_reddit = false) => {
  if (commentIsRemoved(redditComment)) {
    commentToMark.removed = true
    if (is_reddit) {
      commentToMark.removedby = UNKNOWN_REMOVED
    }
  } else if (commentIsDeleted(redditComment)) {
    commentToMark.deleted = true
  }
}

export const set_link_permalink = (revedditComment, redditComment) => {
  revedditComment.link_permalink = redditComment.permalink.split('/').slice(0,6).join('/')+'/'
}

export const combinePushshiftAndRedditComments = (pushshiftComments, redditComments, requirePushshiftData=false, post=undefined) => {
  const combinedComments = {}
  Object.values(redditComments).forEach(comment => {
    if (! requirePushshiftData) {
      initializeComment(comment, post)
      combinedComments[comment.id] = comment
      markRemoved(comment, comment, true)
    }
    const ps_comment = pushshiftComments[comment.id]
    if (ps_comment) {
      markRemoved(comment, ps_comment)
    }
  })
  // Replace pushshift data with reddit and mark removedby
  Object.values(pushshiftComments).forEach(ps_comment => {
    const redditComment = redditComments[ps_comment.id]
    ps_comment.name = 't1_'+ps_comment.id // name needed for info page render
    initializeComment(ps_comment, post)
    if (ps_comment.archive_processed) {
      combinedComments[ps_comment.id] = ps_comment
    } else if (redditComment !== undefined) {
      setupCommentMeta(ps_comment, redditComment)
      combinedComments[ps_comment.id] = ps_comment
    } else {
      // known issue: r/all/comments?before=1538269380 will show some comments whose redditComment has no data
      //              looks like spam that was removed
      //console.log(ps_comment.id)
    }
  })
  console.log(`Pushshift: ${Object.keys(pushshiftComments).length} comments`)
  console.log(`Reddit: ${Object.keys(redditComments).length} comments`)
  return combinedComments
}

export const copyFields = (fields, source, target, if_value = false) => {
  for (const field of fields) {
    if (! if_value || source[field]) {
      target[field] = source[field]
    }
  }
}

const setupCommentMeta = (archiveComment, redditComment) => {
  const retrievalLatency = archiveComment.retrieved_on ? archiveComment.retrieved_on - archiveComment.created_utc : 9999
  set_link_permalink(archiveComment, redditComment)
  copyFields(copy_fields, redditComment, archiveComment)
  copyFields(copy_if_value_fields, redditComment, archiveComment, true)
  if (! redditComment.link_title) {
    archiveComment.link_title = redditComment.permalink.split('/')[5].replace(/_/g, ' ')
  }

  if (typeof(redditComment.num_comments) !== 'undefined') {
    archiveComment.num_comments = redditComment.num_comments
  }
  if (! redditComment.deleted) {
    const modlog = archiveComment.modlog
    const modlog_says_bot_removed = modlogSaysBotRemoved(modlog, redditComment)
    if (archiveComment.body) {
      // on r/subreddit/comments pages this is inaccurate b/c modlogs are only combined with the first set of results from pushshift
      // so, the 'temporarily visible' tag there is missing for older comments
      // works fine on thread pages: when combine is done, all results from pushshift are available to compare with modlogs
      archiveComment.archive_body_removed_before_modlog_copy = commentIsRemoved(archiveComment)
    } else if (modlog && ! commentIsRemoved(modlog)) {
      //handles case where the archive has no record of the comment
      archiveComment.archive_body_removed_before_modlog_copy = true
    }
    if (modlog) {
      archiveComment.author = modlog.author
      archiveComment.body = modlog.body
    }
    const archive_body_removed = commentIsRemoved(archiveComment)
    archiveComment.archive_body_removed = archive_body_removed
    if (! commentIsRemoved(redditComment)) {
      if (archive_body_removed || modlog_says_bot_removed) {
        archiveComment.removedby = AUTOMOD_REMOVED_MOD_APPROVED
      } else {
        archiveComment.removedby = NOT_REMOVED
      }
      archiveComment.author = redditComment.author
      archiveComment.body = redditComment.body
    } else {
      if (archive_body_removed) {
        if ( retrievalLatency <= AUTOMOD_LATENCY_THRESHOLD || modlog_says_bot_removed) {
          archiveComment.removedby = AUTOMOD_REMOVED
        } else {
          archiveComment.removedby = UNKNOWN_REMOVED
        }
      } else if (modlog_says_bot_removed) {
        archiveComment.removedby = AUTOMOD_REMOVED
      } else {
        archiveComment.removedby = MOD_OR_AUTOMOD_REMOVED
      }
    }
  } else if (commentIsDeleted(redditComment)) {
    // modlog entries that were later deleted by the user didn't have author and body fields,
    // causing errors in later processing where those fields are assumed to exist
    archiveComment.author = redditComment.author
    archiveComment.body = redditComment.body
  }
  archiveComment.archive_processed = true
}

// Using Pushshift may be faster, but it is missing the quarantine field in submissions data
export const getPostDataForComments = ({comments = undefined, link_ids_set = undefined, source = 'reddit'}) => {
  if (! link_ids_set) {
    link_ids_set = Object.values(comments).reduce((map, obj) => (map[obj.link_id] = true, map), {})
  }
  let queryFunction = getRedditItems
  if (source === 'pushshift') {
    queryFunction = getPushshiftPostsForCommentData
  }
  return queryFunction(Object.keys(link_ids_set), 'name', null, oauth_reddit, useProxy)
  .catch(() => { console.error(`Unable to retrieve full titles from ${source}`) })
}

export const applyPostAndParentDataToComment = (postData, comment, applyPostLabels = true) => {
  const post = postData[comment.link_id]
  comment.link_title = post.title
  comment.link_flair_text = post.link_flair_text
  comment.link_created_utc = post.created_utc
  comment.link_score = post.score
  if (post.url) {
    comment.url = post.url
  }
  if (typeof(post.num_comments) !== 'undefined') {
    comment.num_comments = post.num_comments
  }
  ['quarantine', 'subreddit_subscribers'].forEach(field => {
    comment[field] = post[field]
  })
  if ('author' in post && post.author === comment.author
      && comment.author !== '[deleted]') {
    comment.is_op = true
  }
  if (! post.over_18 && ! comment.over_18 && applyPostLabels) {
    if (! post.is_robot_indexable) {
      if (postIsDeleted(post)) {
        comment.post_removed_label = 'deleted'
      } else {
        comment.post_removed_label = 'removed'
      }
    }
    const parent = postData[comment.parent_id]
    if (comment.parent_id.slice(0,2) === 't1' && parent) {
      if (commentIsRemoved(parent)) {
        comment.parent_removed_label = 'removed'
      } else if (commentIsDeleted(parent)) {
        comment.parent_removed_label = 'deleted'
      }
    }
  }
}

export const getRevdditComments = ({pushshiftComments, subreddit_about_promise = Promise.resolve({})}) => {
  const postDataPromise = getPostDataForComments({comments: pushshiftComments, useProxy})
  const combinePromise = retrieveRedditComments_and_combineWithPushshiftComments(pushshiftComments)
  return Promise.all([postDataPromise, combinePromise, subreddit_about_promise])
  .then(values => {
    const show_comments = []
    const postData = values[0]
    const combinedComments = values[1]
    const subredditAbout = values[2] || {}
    Object.values(combinedComments).forEach(comment => {
      if (postData && comment.link_id in postData) {
        const post_thisComment = postData[comment.link_id]
        if ( ! (post_thisComment.whitelist_status === 'promo_adult_nsfw' &&
               (comment.removed || comment.deleted))) {
          applyPostAndParentDataToComment(postData, comment, ! subredditAbout.over18)
          show_comments.push(comment)
        }
      } else {
        show_comments.push(comment)
      }
    })
    return show_comments
  })
}

export const copyModlogItemsToArchiveItems = (modlogsItems, archiveItems) => {
  for (const ml_item of Object.values(modlogsItems)) {
    const id = ml_item.id
    const link_id = ml_item.link_id
    const archive_item = archiveItems[id]
    const modlog = {
      author: ml_item.target_author,
      body: ml_item.target_body,
      link_id,
      created_utc: ml_item.created_utc,
      mod: ml_item.mod,
      details: ml_item.details
    }
    if (archive_item) {
      archive_item.modlog = modlog
    } else {
      archiveItems[id] = {id, link_id, modlog}
    }
  }
}

export const combinedGetCommentsBySubreddit = (args) => {
  return combinedGetItemsBySubredditOrDomain({...args,
    pushshiftQueryFn: pushshiftGetCommentsBySubreddit,
    postProcessCombine_Fn: getRevdditComments,
    postProcessCombine_ItemsArgName: 'pushshiftComments',
  })
}

export const setSubredditMeta = async (subreddit, global) => {
  let moderators_promise = getModerators(subreddit)
  let subreddit_about_promise = getSubredditAbout(subreddit)
  let over18 = false
  const subreddit_lc = subreddit.toLowerCase()
  await Promise.all([moderators_promise, subreddit_about_promise])
  .catch((e) => {
    if (e.reason === 'quarantined') {
      useProxy = true
      moderators_promise = getModerators(subreddit, true)
      subreddit_about_promise = getSubredditAbout(subreddit, true)
    }
    return Promise.all([moderators_promise, subreddit_about_promise])
  })
  .then(([moderators, subreddit_about]) => {
    if (isEmptyObj(moderators) && isEmptyObj(subreddit_about)) {
      window.location.href = `/v/${subreddit}/top/#banned`
    }
    over18 = subreddit_about.over18
    global.setState({moderators: {[subreddit_lc]: moderators}, over18})
  })
  return {subreddit_about_promise}
}

export const getRevdditCommentsBySubreddit = async (subreddit, global) => {
  const {n, before, before_id} = global.state

  if (subreddit === 'all') {
    subreddit = ''
  }
  const {subreddit_about_promise} = await setSubredditMeta(subreddit, global)
  const modlogs_promise = getModlogsComments(subreddit)

  return combinedGetCommentsBySubreddit({subreddit, n, before, before_id, global,
    subreddit_about_promise, modlogs_promise})
  .then(() => {
    global.setSuccess()
  })
}

export const modlogSaysBotRemoved = (modlog, item) => {
  return modlog &&
    ((modlog.created_utc - item.created_utc) <= AUTOMOD_LATENCY_THRESHOLD
    || ['automoderator', 'bot'].includes(modlog.mod.toLowerCase()))
}
