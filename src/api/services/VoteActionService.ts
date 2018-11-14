// Copyright (c) 2017-2018, The Particl Market developers
// Distributed under the GPL software license, see the accompanying
// file COPYING or https://github.com/particl/particl-market/blob/develop/LICENSE

import * as Bookshelf from 'bookshelf';
import * as _ from 'lodash';
import { inject, named } from 'inversify';
import { Logger as LoggerType } from '../../core/Logger';
import { Types, Core, Targets, Events } from '../../constants';
import { Vote } from '../models/Vote';
import { VoteCreateRequest } from '../requests/VoteCreateRequest';
import { SmsgService } from './SmsgService';
import { MarketplaceMessage } from '../messages/MarketplaceMessage';
import { EventEmitter } from 'events';
import * as resources from 'resources';
import { MarketplaceEvent } from '../messages/MarketplaceEvent';
import { VoteFactory } from '../factories/VoteFactory';
import { VoteService } from './VoteService';
import { SmsgSendResponse } from '../responses/SmsgSendResponse';
import { VoteMessageType } from '../enums/VoteMessageType';
import { CoreRpcService } from './CoreRpcService';
import { MessageException } from '../exceptions/MessageException';
import { VoteMessage } from '../messages/VoteMessage';
import { ProposalService } from './ProposalService';
import { VoteUpdateRequest } from '../requests/VoteUpdateRequest';
import { ProposalResultService } from './ProposalResultService';
import { ProposalResultUpdateRequest } from '../requests/ProposalResultUpdateRequest';
import { ProposalOptionResultUpdateRequest } from '../requests/ProposalOptionResultUpdateRequest';
import { ProposalOptionService } from './ProposalOptionService';
import { ProposalOptionResultService } from './ProposalOptionResultService';
import { ProposalType } from '../enums/ProposalType';
import { ProposalOptionResult } from '../models/ProposalOptionResult';
import { ListingItemService } from './ListingItemService';
import { SmsgMessageService } from './SmsgMessageService';
import { SmsgMessageStatus } from '../enums/SmsgMessageStatus';
import { ProfileService } from './ProfileService';
import { Profile } from '../models/Profile';

export class VoteActionService {

    public log: LoggerType;

    constructor(
        @inject(Types.Factory) @named(Targets.Factory.VoteFactory) private voteFactory: VoteFactory,
        @inject(Types.Service) @named(Targets.Service.SmsgService) public smsgService: SmsgService,
        @inject(Types.Service) @named(Targets.Service.CoreRpcService) public coreRpcService: CoreRpcService,
        @inject(Types.Service) @named(Targets.Service.ProposalService) public proposalService: ProposalService,
        @inject(Types.Service) @named(Targets.Service.ProposalOptionService) public proposalOptionService: ProposalOptionService,
        @inject(Types.Service) @named(Targets.Service.ProposalResultService) public proposalResultService: ProposalResultService,
        @inject(Types.Service) @named(Targets.Service.ProposalOptionResultService) public proposalOptionResultService: ProposalOptionResultService,
        @inject(Types.Service) @named(Targets.Service.VoteService) public voteService: VoteService,
        @inject(Types.Service) @named(Targets.Service.ListingItemService) public listingItemService: ListingItemService,
        @inject(Types.Service) @named(Targets.Service.SmsgMessageService) private smsgMessageService: SmsgMessageService,
        @inject(Types.Service) @named(Targets.Service.ProfileService) private profileService: ProfileService,
        @inject(Types.Core) @named(Core.Events) public eventEmitter: EventEmitter,
        @inject(Types.Core) @named(Core.Logger) public Logger: typeof LoggerType
    ) {
        this.log = new Logger(__filename);
        this.configureEventListeners();
    }

    /**
     *
     * @param {"resources".Proposal} proposal
     * @param {"resources".ProposalOption} proposalOption
     * @param {"resources".Profile} senderProfile
     * @param {"resources".Market} marketplace
     * @returns {Promise<SmsgSendResponse>}
     */
    public async send( proposal: resources.Proposal, proposalOption: resources.ProposalOption,
                       senderProfile: resources.Profile, marketplace: resources.Market): Promise<SmsgSendResponse> {
        /*
         * TODO:
         * If senderProfile has balance (weight) <= 0
         *     Skip sending this vote, waste of time since it has no weight.
         */

        const voteMessage = await this.voteFactory.getMessage(VoteMessageType.MP_VOTE, proposal, proposalOption,
            senderProfile.address);

        const msg: MarketplaceMessage = {
            version: process.env.MARKETPLACE_VERSION,
            mpaction: voteMessage
        };

        /*
         * TODO:
         * Create vote locally
         */

        return this.smsgService.smsgSend(senderProfile.address, marketplace.address, msg, false,
                                         Math.ceil((proposal.expiredAt  - new Date().getTime()) / 1000 / 60 / 60 / 24));
    }

    /**
     * process received VoteMessage
     * - save ActionMessage
     * - create Proposal
     *
     * @param {MarketplaceEvent} event
     * @returns {Promise<module:resources.Bid>}
     */
    public async processVoteReceivedEvent(event: MarketplaceEvent): Promise<SmsgMessageStatus> {
        const message = event.marketplaceMessage;
        if (!message.mpaction) {   // ACTIONEVENT
            throw new MessageException('Missing mpaction.');
        }

        const voteMessage: VoteMessage = event.marketplaceMessage.mpaction as VoteMessage;
        if (voteMessage.voter !== event.smsgMessage.from) {
            throw new MessageException('Voter does not match with sender.');
        }

        // get proposal and ignore vote if we're past the final block of the proposal
        return await this.proposalService.findOneByHash(voteMessage.proposalHash)
            .then(async proposalModel => {

                const proposal = proposalModel.toJSON();
                /*
                 * Are any of these votes from one of our profiles?
                 *     Ignore the vote, we've already created it locally
                 * Else, process vote
                 */
                let weAreTheVoter = false;
                const profilesCollection: Bookshelf.Collection<Profile> = await this.profileService.findAll();
                const profiles: resources.Profile[] = profilesCollection.toJSON();
                for (const profile of profiles) {
                    if (profile.address === voteMessage.voter) {
                        this.log.debug(`profile.Address (${profile.address}) === voteMessage.voter (${voteMessage.voter})`);
                        weAreTheVoter = true;
                        break;
                    }
                }
                if (weAreTheVoter) {
                    this.log.debug('This vote should have already been created locally. Skipping.');
                } else {
                    this.log.debug('This vote should not exist already locally. Process the vote.');

                    // just make sure we have one
                    if (_.isEmpty(proposal.ProposalResults)) {
                        throw new MessageException('ProposalResult should not be empty!');
                    }

                    // const currentBlock: number = await this.coreRpcService.getBlockCount();
                    // this.log.debug('before update, proposal:', JSON.stringify(proposal, null, 2));

                    if (voteMessage && event.smsgMessage.daysretention >= 1) {
                        const weight = await this.voteService.getVoteWeight(voteMessage.voter);

                        // If vote has weight of 0, ignore, no point saving a weightless vote.
                        // If vote has a weight > 0, process and save it.
                        if (weight > 0) {
                            const createdVote = await this.createOrUpdateVote(voteMessage, proposal, weight, event.smsgMessage);
                            this.log.debug('created/updated Vote:', JSON.stringify(createdVote, null, 2));

                            const proposalResult: resources.ProposalResult = await this.proposalService.recalculateProposalResult(proposal);

                            // todo: extract method
                            if (proposal.type === ProposalType.ITEM_VOTE
                                && await this.shouldRemoveListingItem(proposalResult)) {

                                // remove the ListingItem from the marketplace (unless user has Bid/Order related to it).
                                const listingItemId = await this.listingItemService.findOne(proposal.FlaggedItem.listingItemId, false)
                                    .then(value => {
                                        return value.Id;
                                    }).catch(reason => {
                                        // ignore
                                        return null;
                                    });
                                if (listingItemId) {
                                    await this.listingItemService.destroy(listingItemId);
                                }
                            } else {
                                this.log.debug('No item destroyed.');
                            }
                            // TODO: do whatever else needs to be done
                        }
                        return SmsgMessageStatus.PROCESSED;
                    } else {
                        throw new MessageException('Missing VoteMessage');
                    }
                }
                return SmsgMessageStatus.PROCESSED;
            })
            .catch(reason => {
                return SmsgMessageStatus.WAITING;
            });
    }

    /**
     * todo: move to listingItemService
     *
     * @param {"resources".ProposalResult} proposalResult
     * @returns {Promise<boolean>}
     */
    private async shouldRemoveListingItem(proposalResult: resources.ProposalResult): Promise<boolean> {
        const okOptionResult = _.find(proposalResult.ProposalOptionResults, (proposalOptionResult: resources.ProposalOptionResult) => {
            return proposalOptionResult.ProposalOption.optionId === 0;
        });
        const removeOptionResult = _.find(proposalResult.ProposalOptionResults, (proposalOptionResult: resources.ProposalOptionResult) => {
            return proposalOptionResult.ProposalOption.optionId === 1; // 1 === REMOVE
        });

        // Requirements to remove the ListingItem from the testnet marketplace, these should also be configurable:
        // at minimum, a total of env.MINIMUM_REQUIRED_VOTES votes
        // at minimum, 50% of votes saying remove

        this.log.debug('process.env.MINIMUM_REQUIRED_VOTES = ' + process.env.MINIMUM_REQUIRED_VOTES);
        if (removeOptionResult && okOptionResult) {
            const totalNumVoters = okOptionResult.voters + removeOptionResult.voters;
            if (totalNumVoters > (process.env.MINIMUM_REQUIRED_VOTES || 1000)
                && ((removeOptionResult.weight / (removeOptionResult.weight + okOptionResult.weight)) > 0.5)) {
                this.log.debug('Item should be destroyed');
                return true;
            }
        }
        this.log.debug('Item should NOT be destroyed');
        return false;
    }

    /**
     *
     * @param {VoteMessage} voteMessage
     * @param {"resources".Proposal} proposal
     * @param {number} currentBlock
     * @param {number} weight
     * @returns {Promise<"resources".Vote>}
     */
    private async createOrUpdateVote(voteMessage: VoteMessage, proposal: resources.Proposal,
                                     weight: number, voteSmsg: resources.SmsgMessage): Promise<resources.Vote> {

        let lastVote: any;
        try {
            const lastVoteModel = await this.voteService.findOneByVoterAndProposalId(voteMessage.voter, proposal.id);
            lastVote = lastVoteModel.toJSON();
        } catch (ex) {
            lastVote = null;
        }
        const create: boolean = lastVote == null;

        // create a vote
        const voteRequest = await this.voteFactory.getModel(voteMessage, proposal, weight, create, voteSmsg);

        let voteModel;
        if (create) {
            // this.log.debug('Creating vote request = ' + JSON.stringify(voteRequest, null, 2));
            voteModel = await this.voteService.create(voteRequest);
        } else {
            // this.log.debug(`Updating vote with id = ${lastVote.id}, vote request = ` + JSON.stringify(voteRequest, null, 2));
            voteModel = await this.voteService.update(lastVote.id, voteRequest as VoteUpdateRequest);
            // this.voteService.destroy(lastVote.id);
            // voteModel = await this.voteService.create(voteRequest as VoteCreateRequest);
        }
        if (!voteModel) {
            this.log.error('VoteActionService.createOrUpdateVote(): Vote wasn\'t saved or updated properly. Return val is empty.');
            throw new MessageException('Vote wasn\'t saved or updated properly. Return val is empty.');
        }
        const vote = voteModel.toJSON();
        return vote;
    }

    private configureEventListeners(): void {
        this.log.info('Configuring EventListeners ');

        this.eventEmitter.on(Events.VoteReceivedEvent, async (event) => {
            this.log.debug('Received event:', JSON.stringify(event, null, 2));
            await this.processVoteReceivedEvent(event)
                .then(async status => {
                    await this.smsgMessageService.updateSmsgMessageStatus(event.smsgMessage, status);
                })
                .catch(async reason => {
                    this.log.error('PROCESSING ERROR: ', reason);
                    await this.smsgMessageService.updateSmsgMessageStatus(event.smsgMessage, SmsgMessageStatus.PARSING_FAILED);
                });
        });
    }
}
