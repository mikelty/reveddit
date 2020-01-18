import React from 'react'
import { prettyScore, parse, isRemoved, replaceAmpGTLT } from 'utils'
import Time from 'pages/common/Time'
import RemovedBy from 'pages/common/RemovedBy'
import { NOT_REMOVED } from 'pages/common/RemovedBy'
import CommentBody from 'pages/common/CommentBody'
import { connect } from 'state'

class Comment extends React.Component {
  state = {
    displayBody: true
  }
  toggleDisplayBody() {
    this.setState({displayBody: ! this.state.displayBody})
  }
  getExpandIcon() {
    if (this.state.displayBody) {
      return '[–]'
    } else {
      return '[+]'
    }
  }

  render() {
    const props = this.props
    let classNames = ['comment', 'user']
    const reddit = 'https://www.reddit.com'
    let submitter = ''
    if (props.is_op) {
      submitter = ' submitter'+' '
    }
    if (props.removed) {
      classNames.push('removed')
    } else if (props.deleted) {
      classNames.push('deleted')
    } else {
      classNames.push('comment-even')
    }
    props.quarantine && classNames.push('quarantine')
    props.locked && classNames.push('locked')

    let author = props.author
    if (props.deleted) {
      author = '[deleted]'
    }

    let directlink = ''
    if (props.prev) {
      directlink = `?after=${props.prev}&`
    } else if (props.next) {
      directlink = `?before=${props.next}&`
    }
    if (directlink) {
      directlink += `limit=1&sort=${props.sort}&show=${props.name}&removal_status=all`
    }

    const mods_message_body = '\n\n\n'+reddit+props.permalink;
    const mods_link = reddit+'/message/compose?to=/r/'+props.subreddit+'&message='+encodeURI(mods_message_body);

    return (
      <div id={props.name} className={classNames.join(' ')} data-fullname={props.name} data-created_utc={props.created_utc}>
        <div className='comment-head'>
          <a onClick={() => this.toggleDisplayBody()} className='collapseToggle'>{this.getExpandIcon()}</a>
          <span className='space' />
          <a
            href={props.url ? props.url : props.link_permalink}
            className='title'
          >
          {props.link_title}
          </a>
          {'link_author' in props &&
            <React.Fragment>
              <span> by </span>
              <a
                href={`/user/${props.link_author}`}
                className='author'>
                {props.link_author}
              </a>
            </React.Fragment>
          }
          {'subreddit' in props &&
            <React.Fragment>
              <span> in </span>
              <a
                href={`/r/${props.subreddit}`}
                className='subreddit-link subreddit'
                data-subreddit={props.subreddit}
              >
                {`/r/${props.subreddit}`}
              </a>
            </React.Fragment>
          }
        </div>
        <div className='comment-head subhead'>
        <a
          href={`/user/${author}`}
          className={`author ${submitter} ${props.distinguished ? 'distinguished '+props.distinguished : ''}`}
        >
          {author}
          {props.deleted && ' (by user)'}
        </a>
        <span className='space' />
        {
          props.author_flair_text &&
          <React.Fragment>
            <span className='flair'>{replaceAmpGTLT(props.author_flair_text)}</span>
            <span className='space' />
          </React.Fragment>
        }
        <span className='comment-score'>{prettyScore(props.score)} point{(props.score !== 1) && 's'}</span>
        <span className='space' />
        <Time created_utc={props.created_utc}/>
        {props.locked && <span className='lockedTag'>locked</span>}
        <RemovedBy removedby={props.removedby} />
        </div>
        {
          this.state.displayBody ?
            <div className='comment-body-and-links'>
              <CommentBody {...props}/>
              <div className='comment-links'>
                { ! props.deleted &&
                  <React.Fragment>
                    {props.quarantine && <span className="quarantined">quarantined</span>}
                    { directlink && <a href={directlink}>directlink</a>}
                    <a href={props.permalink+`?context=3#${props.name}`}>context</a>
                    {props.link_permalink &&
                      <a href={props.link_permalink.replace(/^https:\/\/[^/]*/,'')}>full comments
                        {'num_comments' in props && `(${props.num_comments})`}</a>
                    }
                    <a href={mods_link} target="_blank">message mods</a>
                  </React.Fragment>
                }
              </div>
            </div>
          : ''
        }
      </div>
    )
  }
}

export default connect(Comment)
