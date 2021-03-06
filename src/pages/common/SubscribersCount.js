import React from 'react'
import { prettyFormatBigNumber } from 'utils'

const SubscribersCount = ({subreddit_subscribers}) => {
  if (subreddit_subscribers !== undefined) {
    return '('+prettyFormatBigNumber(subreddit_subscribers)+')'
  }
  return null
}

export default SubscribersCount
