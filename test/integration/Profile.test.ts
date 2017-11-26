import { app } from '../../src/app';
import { Logger as LoggerType } from '../../src/core/Logger';
import { Types, Core, Targets } from '../../src/constants';
import { TestUtil } from './lib/TestUtil';
import { TestDataService } from '../../src/api/services/TestDataService';

import { ValidationException } from '../../src/api/exceptions/ValidationException';
import { NotFoundException } from '../../src/api/exceptions/NotFoundException';

import { Profile } from '../../src/api/models/Profile';
import { Country } from '../../src/api/enums/Country';

import { ProfileService } from '../../src/api/services/ProfileService';

describe('Profile', () => {

    const log: LoggerType = new LoggerType(__filename);
    const testUtil = new TestUtil();

    let testDataService: TestDataService;
    let profileService: ProfileService;

    let createdId;

    const testData = {
        name: 'DEFAULT',
        addresses: [{
            title: 'Title',
            addressLine1: 'Add',
            addressLine2: 'ADD 22',
            city: 'city',
            country: Country.SWEDEN
        }, {
            title: 'Tite',
            addressLine1: 'Ad',
            addressLine2: 'ADD 222',
            city: 'city',
            country: Country.FINLAND
        }]
    };

    const testDataUpdated = {
        name: 'DEFAULT2',
        addresses: [{
            title: 'Title New',
            addressLine1: 'Add New',
            addressLine2: 'ADD 22 New',
            city: 'city New',
            country: Country.UNITED_KINGDOM
        }, {
            title: 'Title 2',
            addressLine1: 'Add 2',
            addressLine2: 'ADD 22 22',
            city: 'city 22',
            country: Country.USA
        }, {
            title: 'Title 3',
            addressLine1: 'Add 3',
            addressLine2: 'ADD 3',
            city: 'city 3',
            country: Country.SOUTH_AFRICA
        }]
    };

    beforeAll(async () => {
        await testUtil.bootstrapAppContainer(app);  // bootstrap the app

        testDataService = app.IoC.getNamed<TestDataService>(Types.Service, Targets.Service.TestDataService);
        profileService = app.IoC.getNamed<ProfileService>(Types.Service, Targets.Service.ProfileService);

        // clean up the db, first removes all data and then seeds the db with default data
        await testDataService.clean([], false);
    });

    afterAll(async () => {
        //
    });

    test('Should create a new profile', async () => {
        const profileModel: Profile = await profileService.create(testData);
        createdId = profileModel.Id;

        const result = profileModel.toJSON();

        expect(result.name).toBe(testData.name);
        expect(result.Addresses).toHaveLength(2);
    });

    test('Should throw ValidationException because we want to create a empty profile', async () => {
        expect.assertions(1);
        await profileService.create({}).catch(e =>
            expect(e).toEqual(new ValidationException('Request body is not valid', []))
        );
    });

    test('Should list profiles with our new create one', async () => {
        const profileCollection = await profileService.findAll();
        const profile = profileCollection.toJSON();
        expect(profile.length).toBe(1);

        const result = profile[0];

        expect(result.name).toBe(testData.name);
        expect(result.Addresses).toBe(undefined); // doesnt fetch related
    });

    test('Should return one profile', async () => {
        const profileModel: Profile = await profileService.findOne(createdId);
        const result = profileModel.toJSON();

        expect(result.name).toBe(testData.name);
        expect(result.Addresses).toHaveLength(2);
    });

    test('Should update the profile', async () => {
        const profileModel: Profile = await profileService.update(createdId, testDataUpdated);
        const result = profileModel.toJSON();

        expect(result.name).toBe(testDataUpdated.name);
        expect(result.Addresses).toHaveLength(3);
    });

    test('Should delete the profile', async () => {
        await profileService.destroy(createdId);

        await profileService.findOne(createdId).catch(e =>
            expect(e).toEqual(new NotFoundException(createdId))
        );
    });

});
