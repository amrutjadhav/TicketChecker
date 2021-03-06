const slackPublisher = require('../publishers/slack')
const logger = require('../../config/logger')
const cardModel = require('../models/card')
const cardUtilities = require('../utilities/card')
const commonUtilities = require('../utilities/common')

class Card {
  constructor(action) {
    this.action = action
    this.pipelineConfig = commonUtilities.getScopeConfig(this.action.data.board.id)
    this.handlerDispatcher()
  }

  handlerDispatcher() {
    switch(this.action.type) {
    case 'createCard':
      this.handlerCreateCard()
      break
    case 'updateCard':
      this.handleUpdateCard()
      break
    case 'deleteCard':
      this.handleArchivedCardAction()
      break
    }
    return
  }

  handlerCreateCard() {
    let card = {id: this.action.data.card.id}
    // Don't run all the rules, right now. To create card, you only have to give title to card.
    // Other fields have to written explicitly by opening card. So if we run validations on create,
    // most of the it will return false.
    cardUtilities.createCardDoc(card).then((doc)=> {
      logger.info('saved card.')
    }, (error) => {
      logger.error(error)
    }).catch((error) => {
      logger.error(error)
    })
  }

  handleUpdateCard() {
    let rules = this.pipelineConfig.cardRules
    switch(this.action.display.translationKey) {
    case 'action_move_card_from_list_to_list':
      rules = rules.concat(this.getListRules())
      break
    case 'action_archived_card':
      this.handleArchivedCardAction()
      break
    }

    this.executeRules(rules, 'updateCard')
  }

  handleArchivedCardAction() {
    let cardId = this.action.data.card.id
    cardUtilities.deleteCardDoc(cardId)
  }

  getListRules() {
    let cardList = this.action.data.listAfter.name.toLowerCase()
    if(this.pipelineConfig.listRules[cardList])
      return this.pipelineConfig.listRules[cardList]
    return []
  }

  executeRules(rules, eventType) {
    // if rules are empty, just return
    if(!rules.length) {
      return
    }

    let cardId = this.action.data.card.id
    cardUtilities.fetchCard(cardId, {attachments: true, checklists: 'all'}).then((card) => {
      let options = {actionData: this.action.data}
      let result = cardUtilities.executeRules(card, rules, options)

      if(result.ticketValid) {
        // if ticket is valid, delete the entry from DB.
        cardUtilities.deleteCardDoc(card.id)
      } else {
        this.handleInvalidCard(card, result.errorMessages, eventType)
      }
    }, (error) => {
      logger.error(error)
    }).catch((exception) => {
      logger.error(exception)
    })
  }

  handleInvalidCard(card, errorMessages, eventType) {
    if(eventType == 'createCard') {
      // for new card, save card. no need to check
      cardUtilities.createCardDoc(card).then(() => {
        this.notifyErrors(card, errorMessages)
      }, (error) => {
        logger.error(error)
      }).catch((error) => {
        logger.error(error)
      })
    } else if(eventType == 'updateCard') {
      cardModel.findOne({card_id: card.id}, (error, doc) => {
        if(error){
          logger.error(error)
        } else if(!doc) {
          cardUtilities.createCardDoc(card).then(() => {
            this.notifyErrors(card, errorMessages)
          }, (error) => {
            logger.error(error)
            new slackPublisher({msg: 'Your db is having problem'})
          }).catch((error) => {
            logger.error(error)
          })
        } else {
          this.notifyErrors(card, errorMessages)
        }
      })
    }
  }

  notifyErrors(card, errorMessages) {
    let titleMsg = '@' + this.action.memberCreator.username + '\n ☹️ Awwww! Looks like you didn\'t followed the trello ticket standards \n '
    cardUtilities.notifyErrors(titleMsg, card, errorMessages, this.pipelineConfig.defaults.messagePublisher)
  }
}

module.exports = Card
