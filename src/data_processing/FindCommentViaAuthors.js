import React, {useRef, useState, useEffect} from 'react'
import {ifNumParseInt, isCommentID, validAuthor, now} from 'utils'
import {connect, urlParamKeys, create_qparams_and_adjust, updateURL} from 'state'
import { kindsReverse, queryUserPage } from 'api/reddit'
import { Spin, QuestionMarkModal, Help, NewWindowLink } from 'components/Misc'
import { copyFields, initializeComment, retrieveRedditComments_and_combineWithPushshiftComments } from 'data_processing/comments'
import { createCommentTree } from 'data_processing/thread'
import { RestoreIcon } from 'pages/common/svg'
import { getAuth } from 'api/reddit/auth'

const MAX_AUTHORS_NEARBY_BY_DATE = 4
const MAX_AUTHORS_TO_SEARCH = 15

const ONE_MONTH_IN_SECONDS = 30*60*60*24
const ONE_YEAR_IN_SECONDS = 365*60*60*24
const MAX_TIME_FOR_NEW_SORT = 5*ONE_MONTH_IN_SECONDS
const MAX_SCORE_FOR_NEW_SORT = 5

export const get_userPageSortAndTime = ({created_utc, score, controversiality}) => {
  let userPageSort = 'new', userPageTime = ''
  const created_seconds_ago = now - created_utc
  if (created_seconds_ago > MAX_TIME_FOR_NEW_SORT) {
    if (score < 2 || controversiality > 0) {
      userPageSort = 'controversial'
    } else if (score >= MAX_SCORE_FOR_NEW_SORT) {
      userPageSort = 'top'
    }
    if (userPageSort !== 'new' && created_seconds_ago < ONE_YEAR_IN_SECONDS) {
      userPageTime = 'year'
    }
  }
  return {userPageSort, userPageTime}
}

const addAuthorIfExists = (comment, set) => {
  if (comment && validAuthor(comment.author)) {
    set.add(comment.author)
  }
}

export const unarchived_search_button_word = 'Restore'

export const unarchived_search_see_more = <>
  See <NewWindowLink reddit={'/r/removeddit/comments/hy5z7g/_/g4xlrne/'}>search for unarchived comments</NewWindowLink> and <NewWindowLink reddit='/ih86wk'>restored via user page</NewWindowLink> for more information.
</>

export const unarchived_search_help_content = (
  <>
    <p>Clicking '{unarchived_search_button_word}' searches for unarchived comments, adds them if they are found, and updates the URL to save their location so the results can be shared.</p>
    <p>This is useful because sometimes the archive service, called "Pushshift", does not archive data in time. If something is removed before it can be archived then it can only be found on the author's /user page. To find it you need to know the author first. Reveddit can search /user pages of nearby authors, such as the grandparent comment's author, to fill in some of these comments.</p>
    <p>Clicking '{unarchived_search_button_word}' performs this search once for a group of users who have successfully commented in the thread. If there is no result after the first click, clicking more times may yield a result.</p>
    <p>Clicking 'author-focus', 'op-focus', or 'preserve' automatically searches for missing comments from the given author.
       Some new comments that can only be found on user pages may appear.
       This happens when a comment has not yet been archived and it has no replies.
       Removed comments that have no replies do not appear in Reddit's comment tree API.
    </p>
    <p>{unarchived_search_see_more}</p>
  </>
)

const search_comment_help = <Help title={unarchived_search_button_word+' Comment'} content={unarchived_search_help_content}/>

const Wrap = ({children}) => <div style={{padding: '15px 0', minHeight: '25px'}}>{children}</div>

const getAddUserMeta = (props, distance, userPageSort, userPageTime) => {
  const {itemsLookup, alreadySearchedAuthors, threadPost,
   itemsSortedByDate, add_user, loading} = props.global.state
   const grandparentComment = getAncestor(props, itemsLookup, 2)
   const grandchildComment = ((props.replies[0] || {}).replies || [])[0] || {}
   // START nearby authors
   const authors_nearbyByDate = new Set()
   let distance_from_start = distance.current
   if (itemsSortedByDate.length > 1 && 'by_date_i' in props) {
     const comment_i = props.by_date_i
     while (authors_nearbyByDate.size < MAX_AUTHORS_NEARBY_BY_DATE) {
       addAuthorIfExists(itemsSortedByDate[comment_i - distance_from_start], authors_nearbyByDate)
       if (authors_nearbyByDate.size < MAX_AUTHORS_NEARBY_BY_DATE) {
         addAuthorIfExists(itemsSortedByDate[comment_i + distance_from_start], authors_nearbyByDate)
       }
       distance_from_start += 1
       if (   (comment_i+distance_from_start) >= itemsSortedByDate.length
           && (comment_i-distance_from_start) < 0) {
         break
       }
     }
   }
   // END nearby authors
   const aug = new AddUserGroup({alreadySearchedAuthors, sort: userPageSort, time: userPageTime})
   const aup = new AddUserParam({string: add_user})
   aug.add(grandparentComment.author,
           grandchildComment.author,
           ...aup.getAuthors(),
           threadPost.author,
           ...Array.from(authors_nearbyByDate),
          )
  return [aug, distance_from_start]
}

const FindCommentViaAuthors = (props) => {
  const distanceRef = useRef(1)
  // if aug is null && ! loading, populate aug
  // after finishing search, update aug
  const augRef = useRef(null)
  const [localLoading, setLocalLoading] = useState(false)
  let searchButton = ''
  const {itemsLookup, alreadySearchedAuthors, threadPost,
         itemsSortedByDate, add_user, authors:globalAuthors,
         loading: globalLoading, items, commentTree,
        } = props.global.state
  //TODO: check that distance updates properly
  //      -
  const loading = localLoading || globalLoading
  const {userPageSort, userPageTime} = get_userPageSortAndTime(props)
  if (! augRef.current && ! loading) {
    const [new_augRef, new_distanceRef] = getAddUserMeta(props, distanceRef, userPageSort, userPageTime)
    augRef.current = new_augRef
    distanceRef.current = new_distanceRef
  }
  const aug = augRef.current
  const search = async (targetComment) => {
    await setLocalLoading(true)

    //distance.current = distance_from_start
    //TODO: allow aug to allow a second query according to below

    // 1st query: grandparent, grandchild, any author in URL Param, OP, highest karma
           // only add these for search *if they are not in alreadySearchedAuthors*
    // 2nd query:
    //    authors who commented around the same time anywhere in the thread
    //    (only runs if first didn't find the result or first has no authors)
    // is_mod LAST

    const {authors, promises} = await aug.query()
    const {user_comments, newComments} = await Promise.all(promises).then(
      getUserCommentsForPost.bind(null, threadPost, itemsLookup))
    Object.assign(alreadySearchedAuthors, authors)
    const {new_commentTree, new_add_user} = await addUserComments_updateURL_createTreeIfNeeded({
      user_comments, itemsLookup, add_user, threadPost, newComments, items, commentTree, userPageSort, userPageTime})
    //TODO: If failed for clicked item, change messaging
    //         authors remain: "try again" or show % complete (# authors searched / total # authors)
    const [new_augRef, new_distanceRef] = getAddUserMeta(props, distanceRef, userPageSort, userPageTime)
    augRef.current = new_augRef
    distanceRef.current = new_distanceRef
    await setLocalLoading(false)
    return props.global.setSuccess({alreadySearchedAuthors,
                                    add_user: new_add_user || add_user,
                                    commentTree: new_commentTree || commentTree})
  }
  //states:
  //  loading && needToFindAuthors (! aug) => show spin
  //  loading && ! needToFindAuthors (aug)
  //     hasAuthors => show spin
  //     noAuthors => show nothing
  //  ! loading && hasAuthors => show button
  //  ! loading && noAuthors => show nothing
  if (loading) {
    if (! aug || aug.length()) {
      searchButton = <Wrap><Spin width='20px'/></Wrap>
    }
  } else if (aug.length()) {
    const numAuthorsRemaining = Object.keys(globalAuthors).length - Object.keys(alreadySearchedAuthors).length
    if (numAuthorsRemaining) {
      searchButton = (
        <Wrap>
          <a className='pointer bubble medium lightblue' onClick={search}
          ><RestoreIcon/> {unarchived_search_button_word}<span className='desktop-only'> ({numAuthorsRemaining.toLocaleString()} users left)</span></a>
          <QuestionMarkModal modalContent={{content:search_comment_help}} fill='white'/>
        </Wrap>
      )
    }
  }
  return searchButton
}

class AddUserGroup {
  constructor({alreadySearchedAuthors = {}, max = MAX_AUTHORS_TO_SEARCH, sort} = {}) {
    this.alreadySearchedAuthors = alreadySearchedAuthors
    this.max = max
    this.sort = sort
    this.authorsToSearch = {}
    this.itemsToSearch = []
  }
  length() {
    return this.itemsToSearch.length
  }
  getAlreadySearchedAuthors() {
    return this.alreadySearchedAuthors
  }
  add(...authors) {
    let allAdded = true
    for (const author of authors) {
      if (   validAuthor(author)
          && ! (author in this.alreadySearchedAuthors)
          && ! (author in this.authorsToSearch)
          && this.itemsToSearch.length < this.max) {
        this.itemsToSearch.push(new AddUserItem({author, kind: 'c', sort: this.sort}))
        this.authorsToSearch[author] = true
      } else {
        allAdded = false
      }
    }
    return allAdded
  }
  async query() {
    await getAuth()
    return {
      promises: this.itemsToSearch.map(i => i.query()),
      authors: this.authorsToSearch,
    }
  }
}

//AddUserItem represents properties used on thread pages to load data from a user page
const ADDUSERITEM_SEPARATOR = '.'
const ADDUSER_PROPS = ['author', 'limit', 'kind', 'sort', 'time', 'before', 'after']
export class AddUserItem {
  constructor({string = '', ...props}) {
    if (string) {
      this.setPropsFromString(string)
    } else {
      Object.assign(this, props)
      this.kind = kindsReverse[this.kind]
    }
  }
  getOrderedProps() {
    return ADDUSER_PROPS.map(p => this[p])
  }
  setPropsFromString(string) {
    const parts = string.split(ADDUSERITEM_SEPARATOR)
    for (let i = 0; i < parts.length; i++) {
      this[ADDUSER_PROPS[i]] = ifNumParseInt(parts[i])
    }
  }
  query() {
    return queryUserPage(this.author, this.kind || '', this.sort, this.before, this.after, this.time, this.limit || 100)
  }
  toString() {
    return this.getOrderedProps().join(ADDUSERITEM_SEPARATOR)
  }
}

const getAncestor = (props, itemsLookup, n) => {
  if (n === 0) {
    return props
  } else {
    const [type, id] = props.parent_id.split('_')
    const parent = itemsLookup[id]
    if (isCommentID(type) && parent) {
      return getAncestor(parent, itemsLookup, n-1)
    } else {
      return props
    }
  }
}

const ADDUSERPARAM_SEPARATOR = ','
export class AddUserParam {
  constructor({string, items} = {}) {
    if (string) {
      this.items = string.split(ADDUSERPARAM_SEPARATOR).map(i => new AddUserItem({string: i}))
    } else if (items) {
      this.items = items
    } else {
      this.items = []
    }
  }
  addItems(...items) {
    for (const item of items) {
      this.addItem(item)
    }
  }
  addItem(item) {
    if (item instanceof AddUserItem) {
      this.items.push(item)
    } else {
      this.items.push(new AddUserItem(item))
    }
  }
  getItems() {
    return this.items
  }
  getAuthors() {
    return this.items.map(i => i.author)
  }
  toString() {
    if (this.items) {
      const itemKeys = this.items.map(i => i.toString())
      const uniqueItemKeys = [...new Set(itemKeys)]
      return urlParamKeys.add_user+'='+uniqueItemKeys.join(ADDUSERPARAM_SEPARATOR)
    }
    return ''
  }
}

const addUserFields = [
  'body', 'edited', 'author', 'author_fullname', 'author_flair_text',
  'is_op',
]
export const addUserComments = (user_comments, commentsLookup) => {
  const changed = [], changedAuthors = {}
  for (const user_comment of user_comments) {
    const comment = commentsLookup[user_comment.id]
    user_comment.from_add_user = true
    if (comment) {
      if (comment.body !== user_comment.body) {
        comment.from_add_user = true
        changed.push(user_comment)
        changedAuthors[user_comment.author] = user_comment
      }
      copyFields(addUserFields, user_comment, comment)
    } else {
      commentsLookup[user_comment.id] = user_comment
      changed.push(user_comment)
      changedAuthors[user_comment.author] = user_comment
    }
  }
  return {changed, changedAuthors}
}

const updateUrlFromChangedAuthors = (changedAuthors, add_user, userPageSort, userPageTime) => {
  if (Object.keys(changedAuthors).length) {
    const aup = new AddUserParam({string: add_user})
    for (const [author, comment] of Object.entries(changedAuthors)) {
      const item = new AddUserItem({author, kind: 'c',
                                    sort: userPageSort,
                                    time: userPageTime,
                                    ...(userPageSort === 'new' ? comment.before_after : {}),
                                  })
      const item_str = item.toString()
//      if (! add_user.match(new RegExp('(^|,)'+author+'\\b'))) {

      if (! add_user.includes(item_str)) {
        aup.addItem(item)
      }
    }
    const [paramName, value] = aup.toString().split('=')
    updateURL(create_qparams_and_adjust('', paramName, value))
    return value
  }
  return undefined
}

export const addUserComments_and_updateURL = (user_comments, itemsLookup, add_user, userPageSort = 'new', userPageTime = 'all') => {
  const {changed, changedAuthors} = addUserComments(user_comments, itemsLookup)
  const new_add_user = updateUrlFromChangedAuthors(changedAuthors, add_user, userPageSort, userPageTime)
  return new_add_user
}

//existingIDs: IDs already looked up via api/info
//newComments: Comments found via user page that do not appear in existingIDs
export const getUserCommentsForPost = (post, existingIDs, userPages) => {
  const user_comments = []
  const newComments = {}
  for (const userPage of userPages) {
    const comments = userPage.items || []
    let last_comment, first_comment
    const this_user_this_link_comments = []
    for (const [i, c] of comments.entries()) {
      if (i > 0) {
        c.prev = comments[i-1].name
      }
      if ((i+1) < comments.length) {
        c.next = comments[i+1].name
      }
      if (post.name === c.link_id) {
        initializeComment(c, post)
        user_comments.push(c)
        this_user_this_link_comments.push(c)
        if (! (c.id in existingIDs)) {
          newComments[c.id] = c
        }
        if (! first_comment) {
          first_comment = c
        }
        last_comment = c
      }
    }
    if (last_comment) {
      const before = last_comment.next || ''
      const after = first_comment.prev || ''
      const before_after = before ? {before} : {after}
      for (const c of this_user_this_link_comments) {
        c.before_after = before_after
      }
    }
  }
  return {user_comments, newComments}
}

export const addUserComments_updateURL_createTreeIfNeeded = async ({user_comments, itemsLookup, add_user,
  threadPost, newComments, items, commentTree, userPageSort, userPageTime}) => {
  const new_add_user = addUserComments_and_updateURL(user_comments, itemsLookup, add_user, userPageSort, userPageTime)
  let new_commentTree
  if (Object.keys(newComments).length) {
    const combinedComments = await retrieveRedditComments_and_combineWithPushshiftComments(newComments)
    for (const comment of Object.values(combinedComments)) {
      itemsLookup[comment.id] = comment
      items.push(comment)
    }
    //itemsSortedByDate could also be resorted here to get accurate time summary
    //but it's not worth the cost for large threads
    const rootCommentID = window.location.pathname.split('/')[6] ? commentTree[0].id : undefined
    new_commentTree = createCommentTree(threadPost.id, rootCommentID, itemsLookup)
  }
  return {new_add_user, new_commentTree}
}



export default connect(FindCommentViaAuthors)
