// Copyright (c) 2017-2019, The Particl Market developers
// Distributed under the GPL software license, see the accompanying
// file COPYING or https://github.com/particl/particl-market/blob/develop/LICENSE

import * as Bookshelf from 'bookshelf';
import * as _ from 'lodash';
import * as resources from 'resources';
import { inject, named } from 'inversify';
import { Logger as LoggerType } from '../../core/Logger';
import { Types, Core, Targets, Events } from '../../constants';
import { validate, request } from '../../core/api/Validate';
import { NotFoundException } from '../exceptions/NotFoundException';
import { ListingItemRepository } from '../repositories/ListingItemRepository';
import { ListingItem } from '../models/ListingItem';
import { ListingItemCreateRequest } from '../requests/ListingItemCreateRequest';
import { ListingItemUpdateRequest } from '../requests/ListingItemUpdateRequest';
import { MessagingInformationService } from './MessagingInformationService';
import { PaymentInformationService } from './PaymentInformationService';
import { ItemInformationService } from './ItemInformationService';
import { CryptocurrencyAddressService } from './CryptocurrencyAddressService';
import { MarketService } from './MarketService';
import { ListingItemSearchParams } from '../requests/ListingItemSearchParams';
import { ItemInformationCreateRequest } from '../requests/ItemInformationCreateRequest';
import { ItemInformationUpdateRequest } from '../requests/ItemInformationUpdateRequest';
import { PaymentInformationCreateRequest } from '../requests/PaymentInformationCreateRequest';
import { PaymentInformationUpdateRequest } from '../requests/PaymentInformationUpdateRequest';
import { MessagingInformationCreateRequest } from '../requests/MessagingInformationCreateRequest';
import { MessagingInformationUpdateRequest } from '../requests/MessagingInformationUpdateRequest';
import { ListingItemObjectCreateRequest } from '../requests/ListingItemObjectCreateRequest';
import { ListingItemObjectUpdateRequest } from '../requests/ListingItemObjectUpdateRequest';
import { ListingItemTemplateService } from './ListingItemTemplateService';
import { ListingItemFactory } from '../factories/ListingItemFactory';
import { SmsgService } from './SmsgService';
import { ListingItemObjectService } from './ListingItemObjectService';
import { EventEmitter } from 'events';
import { ObjectHash } from '../../core/helpers/ObjectHash';
import { HashableObjectType } from '../enums/HashableObjectType';
import { ActionMessageService } from './ActionMessageService';
import { ProposalService } from './ProposalService';

export class ListingItemService {

    public log: LoggerType;

    constructor(
        @inject(Types.Service) @named(Targets.Service.MarketService) public marketService: MarketService,
        @inject(Types.Service) @named(Targets.Service.CryptocurrencyAddressService) public cryptocurrencyAddressService: CryptocurrencyAddressService,
        @inject(Types.Service) @named(Targets.Service.ItemInformationService) public itemInformationService: ItemInformationService,
        @inject(Types.Service) @named(Targets.Service.PaymentInformationService) public paymentInformationService: PaymentInformationService,
        @inject(Types.Service) @named(Targets.Service.MessagingInformationService) public messagingInformationService: MessagingInformationService,
        @inject(Types.Service) @named(Targets.Service.ListingItemTemplateService) public listingItemTemplateService: ListingItemTemplateService,
        @inject(Types.Service) @named(Targets.Service.ListingItemObjectService) public listingItemObjectService: ListingItemObjectService,
        @inject(Types.Service) @named(Targets.Service.SmsgService) public smsgService: SmsgService,
        @inject(Types.Service) @named(Targets.Service.ActionMessageService) public actionMessageService: ActionMessageService,
        @inject(Types.Service) @named(Targets.Service.ProposalService) public proposalService: ProposalService,
        @inject(Types.Factory) @named(Targets.Factory.ListingItemFactory) private listingItemFactory: ListingItemFactory,
        @inject(Types.Repository) @named(Targets.Repository.ListingItemRepository) public listingItemRepo: ListingItemRepository,
        @inject(Types.Core) @named(Core.Events) public eventEmitter: EventEmitter,
        @inject(Types.Core) @named(Core.Logger) public Logger: typeof LoggerType
    ) {
        this.log = new Logger(__filename);
    }

    public async findAll(): Promise<Bookshelf.Collection<ListingItem>> {
        return await this.listingItemRepo.findAll();
    }

    public async findExpired(): Promise<Bookshelf.Collection<ListingItem>> {
        return await this.listingItemRepo.findExpired();
    }

    public async findOne(id: number, withRelated: boolean = true): Promise<ListingItem> {
        const listingItem = await this.listingItemRepo.findOne(id, withRelated);
        if (listingItem === null) {
            this.log.warn(`ListingItem with the id=${id} was not found!`);
            throw new NotFoundException(id);
        }
        return listingItem;
    }

    /**
     *
     * @param {string} hash
     * @param {boolean} withRelated
     * @returns {Promise<ListingItem>}
     */
    public async findOneByHash(hash: string, withRelated: boolean = true): Promise<ListingItem> {
        const listingItem = await this.listingItemRepo.findOneByHash(hash, withRelated);
        if (listingItem === null) {
            this.log.warn(`ListingItem with the hash=${hash} was not found!`);
            throw new NotFoundException(hash);
        }
        return listingItem;
    }

    /**
     * searchBy ListingItems using given ListingItemSearchParams
     *
     * @param {ListingItemSearchParams} options
     * @param {boolean} withRelated
     * @returns {Promise<Bookshelf.Collection<ListingItem>>}
     */
    @validate()
    public async search(@request(ListingItemSearchParams) options: ListingItemSearchParams,
                        withRelated: boolean = true): Promise<Bookshelf.Collection<ListingItem>> {
        // if valid params
        // todo: check whether category is string or number, if string, try to find the Category by key

        this.log.debug('searchBy(), options: ', JSON.stringify(options, null, 2));
        return await this.listingItemRepo.search(options, withRelated);
    }

    /**
     *
     * @param {ListingItemCreateRequest} data
     * @returns {Promise<ListingItem>}
     */
    @validate()
    public async create( @request(ListingItemCreateRequest) data: ListingItemCreateRequest): Promise<ListingItem> {
        // const startTime = new Date().getTime();

        const body = JSON.parse(JSON.stringify(data));
        // this.log.debug('create ListingItem, body: ', JSON.stringify(body, null, 2));

        body.hash = ObjectHash.getHash(body, HashableObjectType.LISTINGITEM_CREATEREQUEST);

        // extract and remove related models from request
        const itemInformation = body.itemInformation;
        delete body.itemInformation;
        const paymentInformation = body.paymentInformation;
        delete body.paymentInformation;
        const messagingInformation = body.messagingInformation || [];
        delete body.messagingInformation;
        const listingItemObjects = body.listingItemObjects || [];
        delete body.listingItemObjects;

        const actionMessages = body.actionMessages || [];
        delete body.actionMessages;

        // this.log.debug('body:', JSON.stringify(body, null, 2));

        // If the request body was valid we will create the listingItem
        const listingItemModel = await this.listingItemRepo.create(body);
        const listingItem = listingItemModel.toJSON();

        // create related models
        if (!_.isEmpty(itemInformation)) {
            itemInformation.listing_item_id = listingItem.id;
            await this.itemInformationService.create(itemInformation as ItemInformationCreateRequest);
        }

        if (!_.isEmpty(paymentInformation)) {
            paymentInformation.listing_item_id = listingItem.id;
            await this.paymentInformationService.create(paymentInformation as PaymentInformationCreateRequest);
        }

        for (const msgInfo of messagingInformation) {
            msgInfo.listing_item_id = listingItem.id;
            await this.messagingInformationService.create(msgInfo as MessagingInformationCreateRequest)
                .catch(reason => {
                    this.log.error('Error:', JSON.stringify(reason, null, 2));
                });
        }

        // create listingItemObjects
        for (const object of listingItemObjects) {
            object.listing_item_id = listingItem.id;
            await this.listingItemObjectService.create(object as ListingItemObjectCreateRequest)
                .catch(reason => {
                    this.log.error('Error:', JSON.stringify(reason, null, 2));
                });
        }

        // create actionMessages, only used to create testdata
        for (const actionMessage of actionMessages) {
            actionMessage.listing_item_id = listingItem.id;
            await this.actionMessageService.create(actionMessage)
                .catch(reason => {
                    this.log.error('Error:', JSON.stringify(reason, null, 2));
                });
        }

        // finally find and return the created listingItem
        const result = await this.findOne(listingItem.id);

        // this.log.debug('listingItemService.create: ' + (new Date().getTime() - startTime) + 'ms');

        return result;

    }

    /**
     *
     * @param {number} id
     * @param {ListingItemUpdateRequest} data
     * @returns {Promise<ListingItem>}
     */
    @validate()
    public async update(id: number, @request(ListingItemUpdateRequest) data: ListingItemUpdateRequest): Promise<ListingItem> {

        const body = JSON.parse(JSON.stringify(data));
        // this.log.debug('updating ListingItem, body: ', JSON.stringify(body, null, 2));

        body.hash = ObjectHash.getHash(body, HashableObjectType.LISTINGITEM_CREATEREQUEST);

        // find the existing one without related
        const listingItem = await this.findOne(id, false);

        // set new values
        listingItem.Hash = body.hash;
        listingItem.Seller = body.seller;
        listingItem.ExpiryTime = body.expiryTime;
        listingItem.PostedAt = body.postedAt;
        listingItem.ExpiredAt = body.expiredAt;
        listingItem.ReceivedAt = body.receivedAt;
        listingItem.Removed = body.removed;

        // and update the ListingItem record
        const updatedListingItem = await this.listingItemRepo.update(id, listingItem.toJSON());

        // update related ItemInformation
        // if the related one exists allready, then update. if it doesnt exist, create.
        // and if the related one is missing, then remove.
        let itemInformation = updatedListingItem.related('ItemInformation').toJSON() as ItemInformationUpdateRequest;
        if (!_.isEmpty(body.itemInformation)) {
            if (!_.isEmpty(itemInformation)) {
                const itemInformationId = itemInformation.id;
                itemInformation = body.itemInformation;
                itemInformation.listing_item_id = id;
                await this.itemInformationService.update(itemInformationId, itemInformation);
            } else {
                itemInformation = body.itemInformation;
                itemInformation.listing_item_id = id;
                await this.itemInformationService.create(itemInformation as ItemInformationCreateRequest);
            }
        } else if (!_.isEmpty(itemInformation)) {
            await this.itemInformationService.destroy(itemInformation.id);
        }

        // update related PaymentInformation
        // if the related one exists allready, then update. if it doesnt exist, create.
        // and if the related one is missing, then remove.
        let paymentInformation = updatedListingItem.related('PaymentInformation').toJSON() as PaymentInformationUpdateRequest;

        if (!_.isEmpty(body.paymentInformation)) {
            if (!_.isEmpty(paymentInformation)) {
                const paymentInformationId = paymentInformation.id;
                paymentInformation = body.paymentInformation;
                paymentInformation.listing_item_id = id;
                await this.paymentInformationService.update(paymentInformationId, paymentInformation);
            } else {
                paymentInformation = body.paymentInformation;
                paymentInformation.listing_item_id = id;
                await this.paymentInformationService.create(paymentInformation as PaymentInformationCreateRequest);
            }
        } else {
            // empty paymentinfo create request
            if (!_.isEmpty(paymentInformation)) {
                await this.paymentInformationService.destroy(paymentInformation.id);
            }
        }

        // MessagingInformation
        const existingMessagingInformations = updatedListingItem.related('MessagingInformation').toJSON() || [];
        const newMessagingInformation = body.messagingInformation || [];

        // delete MessagingInformation if not exist with new params
        for (const msgInfo of existingMessagingInformations) {
            if (!await this.checkExistingObject(newMessagingInformation, 'publicKey', msgInfo.publicKey)) {
                await this.messagingInformationService.destroy(msgInfo.id);
            }
        }

        // update or create MessagingInformation
        for (const msgInfo of newMessagingInformation) {
            msgInfo.listing_item_id = id;
            const message = await this.checkExistingObject(existingMessagingInformations, 'publicKey', msgInfo.publicKey);
            if (message) {
                message.protocol = msgInfo.protocol;
                message.publicKey = msgInfo.publicKey;
                await this.messagingInformationService.update(message.id, msgInfo as MessagingInformationUpdateRequest);
            } else {
                await this.messagingInformationService.create(msgInfo as MessagingInformationCreateRequest);
            }
        }

        const newListingItemObjects = body.listingItemObjects || [];

        // find related listingItemObjects
        const existingListingItemObjects = updatedListingItem.related('ListingItemObjects').toJSON() || [];

        // find highestOrderNumber
        const highestOrderNumber = await this.findHighestOrderNumber(newListingItemObjects);

        const objectsToBeUpdated = [] as any;
        for (const object of existingListingItemObjects) {
            // check if order number is greter than highestOrderNumber then delete
            if (object.order > highestOrderNumber) {
                await this.listingItemObjectService.destroy(object.id);
            } else {
                objectsToBeUpdated.push(object);
            }
        }
        // create or update listingItemObjects
        for (const object of newListingItemObjects) {
            object.listing_item_id = id;
            const itemObject = await this.checkExistingObject(objectsToBeUpdated, 'order', object.order);

            if (itemObject) {
                await this.listingItemObjectService.update(itemObject.id, object as ListingItemObjectUpdateRequest);
            } else {
                await this.listingItemObjectService.create(object as ListingItemObjectCreateRequest);
            }
        }

        // finally find and return the updated listingItem
        return await this.findOne(id);
    }

    public async updateListingItemTemplateRelation(id: number): Promise<ListingItem> {

        let listingItem = await this.findOne(id, false);
        const templateId = await this.listingItemTemplateService.findOneByHash(listingItem.Hash)
            .then(value => {
                const template = value.toJSON();
                // this.log.debug('found ListingItemTemplate with matching hash, id:', template.id);
                return template.id;
            })
            .catch(reason => {
                // this.log.debug('matching ListingItemTemplate for ListingItem not found.');
            });

        if (templateId) {
            this.log.debug('updating ListingItem relation to ListingItemTemplate.');
            listingItem.set('listingItemTemplateId', templateId);
            await this.listingItemRepo.update(id, listingItem.toJSON());
        }

        listingItem = await this.findOne(id);

        return listingItem;
    }

    /**
     *
     * @param {number} id
     * @returns {Promise<void>}
     */
    public async destroy(id: number): Promise<void> {
        const listingItemModel = await this.findOne(id, true);
        if (!listingItemModel) {
            this.log.error('Item listing does not exist. id = ' + id);
            throw new NotFoundException('Item listing does not exist. id = ' + id);
        }
        const listingItem = listingItemModel.toJSON();

        await this.listingItemRepo.destroy(id);

        // remove related CryptocurrencyAddress if it exists
        if (listingItem.PaymentInformation && listingItem.PaymentInformation.ItemPrice
            && listingItem.PaymentInformation.ItemPrice.CryptocurrencyAddress) {
            await this.cryptocurrencyAddressService.destroy(listingItem.PaymentInformation.ItemPrice.CryptocurrencyAddress.id);
        }
    }

    /**
     * delete expired listing items
     *
     * @returns {Promise<void>}
     */
    public async deleteExpiredListingItems(): Promise<void> {
       const listingItemsModel = await this.findExpired();
       const listingItems = listingItemsModel.toJSON();
       for (const listingItem of listingItems) {
           if (listingItem.expiredAt <= Date()) {
               await this.destroy(listingItem.id);
           }
       }
    }

    /**
     * Flag listing as removed
     *
     * @returns {Promise<void>}
     */
    public async setRemovedFlag(itemHash: string, flag: boolean): Promise<void> {
        const listingItem: resources.ListingItem = await this.findOneByHash(itemHash).then(value => value.toJSON());
        await this.listingItemRepo.update(listingItem.id, {removed: flag});
     }

    /**
     * check if object is exist in a array
     * todo: this is utility function, does not belong here
     *
     * @param {string[]} objectArray
     * @param {string} fieldName
     * @param {string | number} value
     * @returns {Promise<any>}
     */
    private async checkExistingObject(objectArray: string[], fieldName: string, value: string | number): Promise<any> {
        return await _.find(objectArray, (object) => {
            return ( object[fieldName] === value );
        });
    }

    /**
     * find highest order number from listingItemObjects
     *
     * @param {string[]} listingItemObjects
     * @returns {Promise<any>}
     */
    private async findHighestOrderNumber(listingItemObjects: string[]): Promise<any> {
        const highestOrder = await _.maxBy(listingItemObjects, (itemObject) => {
          return itemObject['order'];
        });
        return highestOrder ? highestOrder['order'] : 0;
    }
}
