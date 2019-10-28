import React from 'react'
import scrollToElement from 'scroll-to-element'
import { getRevdditCommentsBySubreddit } from 'data_processing/comments'
import { getRevdditPostsBySubreddit } from 'data_processing/subreddit_posts'
import { getRevdditPostsByDomain } from 'data_processing/posts'
import { getRevdditUserItems, getQueryParams } from 'data_processing/user'
import { getRevdditThreadItems } from 'data_processing/thread'
import { getRevdditItems, getRevdditSearch } from 'data_processing/info'
import { itemIsOneOfSelectedRemovedBy, itemIsOneOfSelectedTags } from 'data_processing/filters'
import Selections from 'pages/common/selections'
import { removedFilter_types, getExtraGlobalStateVars } from 'state'
import { NOT_REMOVED } from 'pages/common/RemovedBy'
import { SimpleURLSearchParams, jumpToHash, get, put } from 'utils'

const getCategorySettings = (page_type, subreddit) => {
  const category_settings = {
    'subreddit_comments': {
      'other': {category: 'link_title',
                category_title: 'Post Title',
                category_unique_field: 'link_id'},
      'all':   {category: 'subreddit',
                category_title: 'Subreddit',
                category_unique_field: 'subreddit'}
    },
    'subreddit_posts': {
      'other': {category: 'domain',
                category_title: 'Domain',
                category_unique_field: 'domain'},
      'all':   {category: 'subreddit',
                category_title: 'Subreddit',
                category_unique_field: 'subreddit'}
    },
    'domain_posts': {category: 'subreddit',
                     category_title: 'Subreddit',
                     category_unique_field: 'subreddit'},
    'user': {category: 'subreddit',
             category_title: 'Subreddit',
             category_unique_field: 'subreddit'},
    'info': {category: 'subreddit',
             category_title: 'Subreddit',
             category_unique_field: 'subreddit'},
    'search': {category: 'subreddit',
               category_title: 'Subreddit',
               category_unique_field: 'subreddit'}
  }
  if (page_type in category_settings) {
    if (subreddit) {
      let sub_type = subreddit.toLowerCase() === 'all' ? 'all' : 'other'
      return category_settings[page_type][sub_type]
    } else {
      return category_settings[page_type]
    }
  } else {
    return {}
  }
}

const getPageTitle = (page_type, string) => {
  switch(page_type) {
    case 'subreddit_posts': {
      return `/r/${string}`
      break
    }
    case 'subreddit_comments': {
      return `/r/${string}/comments`
      break
    }
    case 'domain_posts': {
      return `/domain/${string}`
      break
    }
    case 'user': {
      return `/u/${string}`
      break
    }
    case 'info': {
      return 'by ID revddit info'
      break
    }
    case 'search': {
      return 'search revddit'
      break
    }
  }
  return null

}
const getLoadDataFunctionAndParam = (page_type, subreddit, user, kind, threadID, domain, queryParams) => {
  switch(page_type) {
    case 'subreddit_posts': {
      return [getRevdditPostsBySubreddit, [subreddit]]
      break
    }
    case 'subreddit_comments': {
      return [getRevdditCommentsBySubreddit, [subreddit]]
      break
    }
    case 'domain_posts': {
      return [getRevdditPostsByDomain, [domain]]
      break
    }
    case 'thread': {
      return [getRevdditThreadItems, [threadID]]
      break
    }
    case 'user': {
      return [getRevdditUserItems, [user, kind, queryParams]]
      break
    }
    case 'info': {
      return [getRevdditItems, []]
      break
    }
    case 'search': {
      return [getRevdditSearch, []]
      break
    }
    default: {
      console.error('Unrecognized page type: ['+page_type+']')
    }
  }
  return null
}
const OVERVIEW = 'overview', SUBMITTED = 'submitted', BLANK='', COMMENTS='comments'
const acceptable_kinds = [OVERVIEW, COMMENTS, SUBMITTED, BLANK]
const acceptable_sorts = ['new', 'top', 'controversial', 'hot']

export const withFetch = (WrappedComponent) =>
  class extends React.Component {
    state = {
      items: [],
      threadPost: {},
      num_pages: 0,
      loading: true
    }
    componentDidMount() {
      let subreddit = (this.props.match.params.subreddit || '').toLowerCase()
      const domain = (this.props.match.params.domain || '').toLowerCase()
      const user = (this.props.match.params.user || '' ).toLowerCase()
      const { threadID, kind = '' } = this.props.match.params
      const { userSubreddit } = (this.props.match.params.userSubreddit || '').toLowerCase()
      const queryParams = getQueryParams()
      if (userSubreddit) {
        subreddit = 'u_'+userSubreddit
      }
      const { page_type } = this.props
      const page_title = getPageTitle(page_type, subreddit || user)
      if (page_title) {
        document.title = page_title
      }
      if (page_type === 'user') {
        if (! acceptable_kinds.includes(kind)) {
          this.props.global.setError(Error('Invalid page, check url'))
          return
        }
        if (! acceptable_sorts.includes(queryParams.sort)) {
          this.props.global.setError(Error('Invalid sort type, check url'))
          return
        }
        setTimeout(this.maybeShowSubscribeUserModal, 3000)
      }

      setTimeout(this.maybeShowLanguageModal, 3000)
      this.props.global.setStateFromQueryParams(
                      page_type,
                      new SimpleURLSearchParams(this.props.location.search),
                      getExtraGlobalStateVars(page_type, queryParams.sort))
      .then(result => {

        const [loadDataFunction, params] = getLoadDataFunctionAndParam(page_type, subreddit, user, kind, threadID, domain, queryParams)
        loadDataFunction(...params, this.props.global, this.props.history)
        .then(items => {
          jumpToHash(this.props.history.location.hash)
        })
        .catch(error => {
          console.error(error)
          let modalContent = undefined
          var isFirefox = typeof InstallTrigger !== 'undefined';
          if (navigator.doNotTrack == "1" && isFirefox) {
            modalContent =
              <>
                <p>Error: unable to connect to reddit</p>
                <p>To view this site with Firefox, add an exception for revddit by clicking the shield icon next to the URL:</p>
                <img src="https://i.imgur.com/b1ShxoM.png"/>
                <p>This is necessary because Firefox blocks websites from querying data from a list of other websites, and reddit is on <a href="https://github.com/disconnectme/disconnect-tracking-protection/blob/master/services.json">that list</a>. The list breaks thousands of websites, many of which are documented in links found <a href="https://bugzilla.mozilla.org/show_bug.cgi?id=1101005">here</a>.</p>
                <p>If this does not resolve the issue, there may be a conflicting extension blocking connections.</p>
              </>
          } else {
            modalContent =
              <>
                <p>Error: unable to connect to either reddit or pushshift</p>
                <p>Possible causes:
                  <ul>
                    <li>conflicting extensions that block connections</li>
                    <li>temporary network outage</li>
                    <li>the page contains <span className='quarantined'>quarantined</span> content that requires a <a href="https://chrome.google.com/webstore/detail/revddit-quarantined/cmfgeilnphkjendelakiniceinhjonfh">Chrome</a> or <a href="https://addons.mozilla.org/en-US/firefox/addon/revddit-quarantined/">Firefox</a> extension to view accurately.</li>
                  </ul>
                </p>
              </>
          }
          this.props.openGenericModal(modalContent)
          this.props.global.setError('')
        })
      })
    }
    maybeShowLanguageModal = () => {
      const hasSeenLanguageModal_text = 'hasSeenLanguageModal'
      const hasSeenLanguageModal = get(hasSeenLanguageModal_text, false)
      if (! window.navigator.language.match(/^en\b/) && ! hasSeenLanguageModal) {
        put(hasSeenLanguageModal_text, true)
        this.props.openGenericModal(
          <>
            <p>Hi, when your browser's preferred language is not English, you may need the "revddit language fix" extension to view results accurately:</p>
            <ul>
              <li><a href="https://chrome.google.com/webstore/detail/revddit-language-fix/fcpgnheagjkmelppbpnbpfimmmjicknj">Chrome</a></li>
              <li><a href="https://addons.mozilla.org/en-US/firefox/addon/revddit-language-fix/">Firefox</a> (mobile too)</li>
            </ul>
            <p>Please see details <a href="https://redd.it/d4wtes">here</a>. This pop-up appears once per session while the extension is not installed.</p>
          </>
        )
      }
    }
    maybeShowSubscribeUserModal = () => {
      const hasSeenSubscribeUserModal_text = 'hasSeenSubscribeUserModal'
      const extensionSaysNoSubscriptions = get('extensionSaysNoSubscriptions', false)
      const hasSeenSubscribeUserModal = get(hasSeenSubscribeUserModal_text, false)
      if (extensionSaysNoSubscriptions && ! hasSeenSubscribeUserModal) {
        put(hasSeenSubscribeUserModal_text, true)
        this.props.openGenericModal(
          <>
            <p>To receive alerts when content from this user is removed, click 'subscribe' on the extension icon.</p>
            <img src="https://i.imgur.com/7NRg0sQ.png"/>
            <p>This pop-up appears once per session on user pages while there are no subscriptions.</p>
          </>
        )
      }
    }

    getViewableItems(items, category, category_unique_field) {
      let category_state = this.props.global.state['categoryFilter_'+category]
      const showAllCategories = category_state === 'all'
      return items.filter(item => {
        let itemIsOneOfSelectedCategory = false
        if (category_state === item[category_unique_field]) {
          itemIsOneOfSelectedCategory = true
        }
        return (showAllCategories || itemIsOneOfSelectedCategory)
      })
    }



    getVisibleItemsWithoutCategoryFilter() {
      const removedByFilterIsUnset = this.props.global.removedByFilterIsUnset()
      const tagsFilterIsUnset = this.props.global.tagsFilterIsUnset()
      const visibleItems = []
      const gs = this.props.global.state
      gs.items.forEach(item => {
        if (
          (gs.removedFilter === removedFilter_types.all ||
            (gs.removedFilter === removedFilter_types.not_removed &&
              (! item.deleted && ! item.removed && item.removedby === NOT_REMOVED) ) ||
            (
              gs.removedFilter === removedFilter_types.removed &&
                (item.deleted || item.removed || item.locked ||
                (item.removedby && item.removedby !== NOT_REMOVED))
            )
          ) &&
          ( (removedByFilterIsUnset || itemIsOneOfSelectedRemovedBy(item, gs)) &&
            (tagsFilterIsUnset || itemIsOneOfSelectedTags(item, gs)))
        ) {
          const keywords = gs.keywords.replace(/\s\s+/g, ' ').trim().toLocaleLowerCase().split(' ')
          let match = true
          let titleField = ''
          if ('title' in item) {
            titleField = 'title'
          } else if ('link_title' in item) {
            titleField = 'link_title'
          }
          for (let i = 0; i < keywords.length; i++) {
            const word = keywords[i]
            let word_in_title = true
            if (titleField) {
              word_in_title = item[titleField].toLocaleLowerCase().includes(word)
            }
            if (! (('body' in item && ( word_in_title || item.body.toLocaleLowerCase().includes(word))) ||
                  (word_in_title)
            )) {
              match = false
              break
            }
          }
          if (match) {
            visibleItems.push(item)
          }
        }
      })
      return visibleItems
    }

    render () {
      const subreddit = (this.props.match.params.subreddit || '').toLowerCase()
      const domain = (this.props.match.params.domain || '').toLowerCase()
      const { page_type } = this.props
      const { items, showContext } = this.props.global.state

      let visibleItemsWithoutCategoryFilter = []
      let viewableItems = []
      visibleItemsWithoutCategoryFilter = this.getVisibleItemsWithoutCategoryFilter()
      const {category, category_title, category_unique_field} = getCategorySettings(page_type, subreddit)
      viewableItems = this.getViewableItems(visibleItemsWithoutCategoryFilter, category, category_unique_field)

      const selections =
      <Selections subreddit={subreddit}
                  page_type={page_type}
                  visibleItemsWithoutCategoryFilter={visibleItemsWithoutCategoryFilter}
                  num_showing={viewableItems.length}
                  num_items={items.length}
                  category_type={category} category_title={category_title}
                  category_unique_field={category_unique_field}/>

      return (
        <React.Fragment>
          <WrappedComponent {...this.props} {...this.state} selections={selections}
            viewableItems={viewableItems} visibleItemsWithoutCategoryFilter={visibleItemsWithoutCategoryFilter}/>
        </React.Fragment>
      )
    }
  }
