import {
  getComments as getRedditComments
} from 'api/reddit'
import { commentIsDeleted, commentIsRemoved } from 'utils'
import { AUTOMOD_REMOVED, AUTOMOD_REMOVED_MOD_APPROVED, MOD_OR_AUTOMOD_REMOVED, UNKNOWN_REMOVED, NOT_REMOVED } from 'pages/common/RemovedBy'

export const combinePushshiftAndRedditComments = pushshiftComments => {
  // Extract ids from pushshift response
  const ids = pushshiftComments.map(comment => comment.id)
  const pushshiftCommentLookup = {}
  pushshiftComments.forEach(comment => {
    pushshiftCommentLookup[comment.id] = comment
  })
  // Get all the comments from reddit
  return getRedditComments(ids)
  .then(redditComments => {
    // Temporary lookup for updating score
    const redditCommentLookup = {}
    redditComments.forEach(comment => {
      redditCommentLookup[comment.id] = comment
      const ps_comment = pushshiftCommentLookup[comment.id]
      if (commentIsRemoved(comment)) {
        ps_comment.removed = true
      } else if (commentIsDeleted(comment)) {
        ps_comment.deleted = true
      }

    })

    // Replace pushshift data with reddit and mark removedby
    pushshiftComments.forEach(ps_comment => {
      const retrievalLatency = ps_comment.retrieved_on-ps_comment.created_utc
      const redditComment = redditCommentLookup[ps_comment.id]
      if (redditComment !== undefined) {
        ps_comment.permalink = redditComment.permalink
        ps_comment.link_permalink = redditComment.permalink.split('/').splice(0,6).join('/')+'/'
        ps_comment.link_title = redditComment.permalink.split('/')[5].replace(/_/g, ' ')
        ps_comment.score = redditComment.score
        ps_comment.controversiality = redditComment.controversiality
        if (! commentIsRemoved(redditComment)) {
          ps_comment.author = redditComment.author
          ps_comment.body = redditComment.body
          // could remove latency condition, probably no problem
          if (commentIsRemoved(ps_comment) && retrievalLatency <= 5) {
            ps_comment.removedby = AUTOMOD_REMOVED_MOD_APPROVED
          } else {
            ps_comment.removedby = NOT_REMOVED
          }
        } else {
          if (commentIsRemoved(ps_comment)) {
            if (retrievalLatency <= 5) {
              ps_comment.removedby = AUTOMOD_REMOVED
            } else {
              ps_comment.removedby = UNKNOWN_REMOVED
            }
          } else {
            ps_comment.removedby = MOD_OR_AUTOMOD_REMOVED
          }
        }
      }
    })

    console.log(`Pushshift: ${pushshiftComments.length} comments`)
    console.log(`Reddit: ${redditComments.length} comments`)

  })
}