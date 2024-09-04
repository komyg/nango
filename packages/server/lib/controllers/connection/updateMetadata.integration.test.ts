import { connectionService, seeders } from '@nangohq/shared';
import { multipleMigrations } from '@nangohq/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runServer, shouldBeProtected } from '../../utils/tests.js';

let api: Awaited<ReturnType<typeof runServer>>;

const endpoint = '/connection/metadata';

describe(`PATCH ${endpoint}`, () => {
    beforeAll(async () => {
        await multipleMigrations();

        api = await runServer();
    });
    afterAll(() => {
        api.server.close();
    });

    it('should be protected', async () => {
        const res = await api.fetch(endpoint, {
            method: 'PATCH',
            body: {
                connection_id: '1',
                provider_config_key: 'test',
                metadata: {}
            }
        });

        shouldBeProtected(res);
    });

    it('should validate body with no connection id and no connection token', async () => {
        const env = await seeders.createEnvironmentSeed();

        const res = await api.fetch(endpoint, {
            method: 'PATCH',
            token: env.secret_key,
            body: {
                provider_config_key: 'abc',
                metadata: {}
            }
        });

        expect(res.json).toStrictEqual({
            error: {
                code: 'invalid_body',
                errors: [
                    {
                        code: 'custom',
                        message: 'Either connection_token or connection_id and data_provider_config_key must be provided',
                        path: ['connection_id', 'connection_token', 'data_provider_config_key']
                    }
                ]
            }
        });
        expect(res.res.status).toBe(400);
    });

    it('should validate body with an empty connection id', async () => {
        const { env } = await seeders.seedAccountEnvAndUser();
        const res = await api.fetch(endpoint, {
            method: 'PATCH',
            token: env.secret_key,
            body: {
                connection_id: '',
                provider_config_key: 'test',
                metadata: {}
            }
        });

        expect(res.json).toStrictEqual({
            error: {
                code: 'invalid_body',
                errors: [
                    {
                        code: 'too_small',
                        message: 'String must contain at least 1 character(s)',
                        path: ['connection_id']
                    },
                    {
                        code: 'custom',
                        message: 'Either connection_token or connection_id and data_provider_config_key must be provided',
                        path: ['connection_id', 'connection_token', 'data_provider_config_key']
                    }
                ]
            }
        });
        expect(res.res.status).toBe(400);
    });

    it('should validate body with an empty provider config key', async () => {
        const env = await seeders.createEnvironmentSeed();

        const res = await api.fetch(endpoint, {
            method: 'PATCH',
            token: env.secret_key,
            body: {
                connection_id: 'abc',
                provider_config_key: '',
                metadata: {}
            }
        });

        expect(res.json).toStrictEqual({
            error: {
                code: 'invalid_body',
                errors: [
                    {
                        code: 'too_small',
                        message: 'String must contain at least 1 character(s)',
                        path: ['provider_config_key']
                    },
                    {
                        code: 'custom',
                        message: 'Either connection_token or connection_id and data_provider_config_key must be provided',
                        path: ['connection_id', 'connection_token', 'data_provider_config_key']
                    }
                ]
            }
        });
        expect(res.res.status).toBe(400);
    });

    it('should provide an unknown connection response if a bad connection is provided', async () => {
        const env = await seeders.createEnvironmentSeed();

        const connection_id = 'abc';
        const provider_config_key = 'test';

        const res = await api.fetch(endpoint, {
            method: 'PATCH',
            token: env.secret_key,
            body: {
                connection_id,
                provider_config_key,
                metadata: {}
            }
        });

        const error = (res.json as any).error;
        expect(error.code).toBe('unknown_connection');
        expect(res.res.status).toBe(404);
    });

    it('should provide an unknown connection response if bad connections are provided', async () => {
        const env = await seeders.createEnvironmentSeed();
        const unique_key = 'test-update';
        const connections = await seeders.createConnectionSeed(env, unique_key);

        const connection_id = [connections.connection_id, 'def'];
        const provider_config_key = 'test';

        const res = await api.fetch(endpoint, {
            method: 'PATCH',
            token: env.secret_key,
            body: {
                connection_id,
                provider_config_key,
                metadata: {}
            }
        });

        const error = (res.json as any).error;
        expect(error.code).toBe('unknown_connection');
        expect(res.res.status).toBe(404);
    });

    it('Should update metadata and not overwrite', async () => {
        const env = await seeders.createEnvironmentSeed();
        const unique_key = 'test-update';
        await seeders.createConfigSeed(env, unique_key, 'google');
        const connections = await seeders.createConnectionSeed(env, unique_key);

        const { connection_id, provider_config_key } = connections;

        const initialMetadata = {
            name: 'test',
            host: 'test'
        };

        const res = await api.fetch(endpoint, {
            method: 'PATCH',
            token: env.secret_key,
            body: {
                connection_id,
                provider_config_key,
                metadata: initialMetadata
            }
        });

        expect(res.res.status).toBe(200);
        expect(res.json).toEqual({
            connection_id,
            provider_config_key,
            metadata: initialMetadata
        });

        const { response: connection } = await connectionService.getConnection(connection_id, provider_config_key, env.id);

        expect(connection?.metadata).toEqual(initialMetadata);

        const newMetadata = {
            additionalName: 'test23'
        };

        const resTwo = await api.fetch(endpoint, {
            method: 'PATCH',
            token: env.secret_key,
            body: {
                connection_id,
                provider_config_key,
                metadata: newMetadata
            }
        });

        expect(resTwo.res.status).toBe(200);
        expect(resTwo.json).toEqual({
            connection_id,
            provider_config_key,
            metadata: newMetadata
        });

        const { response: connectionTwo } = await connectionService.getConnection(connection_id, provider_config_key, env.id);
        expect(connectionTwo?.metadata).toEqual({ ...initialMetadata, ...newMetadata });
    });

    it('Should update metadata using the connection token', async () => {
        const env = await seeders.createEnvironmentSeed();
        const unique_key = 'test-update';
        await seeders.createConfigSeed(env, unique_key, 'google');
        const connections = await seeders.createConnectionSeed(env, unique_key);

        const { connection_token, connection_id, provider_config_key } = connections;
        if (!connection_token) {
            throw new Error('Connection token is not defined');
        }

        const initialMetadata = {
            name: 'test',
            host: 'test'
        };

        const res = await api.fetch(endpoint, {
            method: 'PATCH',
            token: env.secret_key,
            body: {
                connection_token,
                metadata: initialMetadata
            }
        });

        expect(res.res.status).toBe(200);
        expect(res.json).toEqual({
            connection_token,
            metadata: initialMetadata
        });

        const { response: connection } = await connectionService.getConnection(connection_id, provider_config_key, env.id);

        expect(connection?.metadata).toEqual(initialMetadata);

        const newMetadata = {
            additionalName: 'test23'
        };

        const resTwo = await api.fetch(endpoint, {
            method: 'PATCH',
            token: env.secret_key,
            body: {
                connection_token,
                metadata: newMetadata
            }
        });

        expect(resTwo.res.status).toBe(200);
        expect(resTwo.json).toEqual({
            connection_token,
            metadata: newMetadata
        });

        const { response: connectionTwo } = await connectionService.getConnection(connection_id, provider_config_key, env.id);
        expect(connectionTwo?.metadata).toEqual({ ...initialMetadata, ...newMetadata });
    });
});
