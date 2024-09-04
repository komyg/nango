import { z } from 'zod';
import { asyncWrapper } from '../../utils/asyncWrapper.js';
import { requireEmptyQuery, zodErrorToHTTP } from '@nangohq/utils';
import type { UpdateMetadata, Metadata, UpdateMetadataBody } from '@nangohq/types';
import { connectionService } from '@nangohq/shared';
import type { Response } from 'express';

const validation = z
    .object({
        connection_id: z.union([z.string().min(1), z.array(z.string().min(1))]).optional(),
        connection_token: z.union([z.string().min(1), z.array(z.string().min(1))]).optional(),
        provider_config_key: z.string().min(1).optional(),
        metadata: z.record(z.unknown())
    })
    .strict()
    .refine(
        (data) => {
            if (data.connection_token || (Array.isArray(data.connection_token) && data.connection_token.length > 0)) {
                return true;
            }

            const validConnectionId = data.connection_id || (Array.isArray(data.connection_id) && data.connection_id.length > 0);
            return validConnectionId && data.provider_config_key;
        },
        {
            message: 'Either connection_token or connection_id and data_provider_config_key must be provided',
            path: ['connection_id', 'connection_token', 'data_provider_config_key']
        }
    );

export const updateMetadata = asyncWrapper<UpdateMetadata>(async (req, res) => {
    const emptyQuery = requireEmptyQuery(req);
    if (emptyQuery) {
        res.status(400).send({ error: { code: 'invalid_query_params', errors: zodErrorToHTTP(emptyQuery.error) } });
        return;
    }

    const val = validation.safeParse(req.body);
    if (!val.success) {
        res.status(400).send({
            error: { code: 'invalid_body', errors: zodErrorToHTTP(val.error) }
        });
        return;
    }

    const { environment } = res.locals;
    const { connectionIds, connectionTokens, providerConfigKey, metadata } = parseBody(val.data);

    if (connectionTokens.length) {
        await updateByConnectionToken(res, connectionTokens, metadata);
    } else {
        await updateByConnectionId(res, connectionIds, providerConfigKey, environment.id, metadata);
    }

    res.status(200).send(req.body);
});

function parseBody(body: UpdateMetadataBody) {
    const { connection_id: connectionIdArg, provider_config_key: providerConfigKey, connection_token: connectionTokenArg, metadata } = body;

    return {
        connectionIds: bodyParamToArray(connectionIdArg),
        connectionTokens: bodyParamToArray(connectionTokenArg),
        providerConfigKey,
        metadata
    };
}

function bodyParamToArray(param: string | string[] | undefined): string[] {
    if (Array.isArray(param)) {
        return param;
    }

    return param ? [param] : [];
}

async function updateByConnectionToken(res: Response, connectionTokens: string[], metadata: Metadata) {
    const storedConnections = await connectionService.getConnectionsByTokens(connectionTokens);
    if (storedConnections.length !== connectionTokens.length) {
        const unkownTokens = connectionTokens.filter((token) => !storedConnections.find((conn) => conn.connection_token === token));
        res.status(404).send({
            error: {
                code: 'unknown_connection',
                message: `Connection with connection tokens: ${unkownTokens.join(', ')} not found. Please make sure the connection exists in the Nango dashboard. No actions were taken on any of the connections as a result of this failure.`
            }
        });
        return;
    }

    await connectionService.updateMetadata(storedConnections, metadata);
}

async function updateByConnectionId(res: Response, connectionIds: string[], providerConfigKey: string | undefined, environmentId: number, metadata: Metadata) {
    const storedConnections = await connectionService.getConnectionsByConnectionIds(connectionIds, providerConfigKey!, environmentId);
    if (storedConnections.length !== connectionIds.length) {
        const unknownIds = connectionIds.filter((connectionId) => !storedConnections.find((conn) => conn.connection_id === connectionId));
        res.status(404).send({
            error: {
                code: 'unknown_connection',
                message: `Connection with connection ids: ${unknownIds.join(', ')} and provider config key ${providerConfigKey} not found. Please make sure the connection exists in the Nango dashboard. No actions were taken on any of the connections as a result of this failure.`
            }
        });
        return;
    }

    await connectionService.updateMetadata(storedConnections, metadata);
}
