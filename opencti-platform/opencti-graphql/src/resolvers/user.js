import { filter } from 'ramda';
import {
  addPerson,
  addUser,
  findAll,
  findById,
  findCapabilities,
  findRoles,
  getCapabilities,
  getRoleCapabilities,
  getRoles,
  logout,
  meEditField,
  removeRole,
  roleRemoveCapability,
  setAuthenticationCookie,
  token,
  userDelete,
  userEditField,
  userRenewToken
} from '../domain/user';
import { logger } from '../config/conf';
import {
  stixDomainEntityAddRelation,
  stixDomainEntityCleanContext,
  stixDomainEntityDelete,
  stixDomainEntityDeleteRelation,
  stixDomainEntityEditContext,
  stixDomainEntityEditField
} from '../domain/stixDomainEntity';
import { groups } from '../domain/group';
import { REL_INDEX_PREFIX } from '../database/elasticSearch';
import passport, { PROVIDERS } from '../config/security';
import { AuthenticationFailure } from '../config/errors';
import { addRole } from '../domain/grant';
import { fetchEditContext } from '../database/redis';

const userResolvers = {
  Query: {
    user: (_, { id }) => findById(id),
    users: (_, args) => findAll(args),
    role: (_, { id }) => findById(id),
    roles: (_, args) => findRoles(args),
    capabilities: (_, args) => findCapabilities(args),
    me: (_, args, { user }) => findById(user.id)
  },
  UsersOrdering: {
    markingDefinitions: `${REL_INDEX_PREFIX}object_marking_refs.definition`,
    tags: `${REL_INDEX_PREFIX}tagged.value`
  },
  UsersFilter: {
    tags: `${REL_INDEX_PREFIX}tagged.internal_id_key`
  },
  User: {
    groups: user => groups(user.id),
    roles: user => getRoles(user.id),
    capabilities: user => getCapabilities(user.id),
    token: (user, args, context) => token(user.id, args, context)
  },
  Role: {
    editContext: role => fetchEditContext(role.id),
    capabilities: role => getRoleCapabilities(role.id)
  },
  Mutation: {
    token: async (_, { input }, context) => {
      // We need to iterate on each provider to find one that validated the credentials
      const formProviders = filter(p => p.type === 'FORM', PROVIDERS);
      if (formProviders.length === 0) {
        logger.error('[Configuration] Cant authenticate without any form providers');
      }
      for (let index = 0; index < formProviders.length; index += 1) {
        const auth = formProviders[index];
        // eslint-disable-next-line no-await-in-loop
        const loginToken = await new Promise(resolve => {
          try {
            passport.authenticate(auth.provider, (err, tokenObject) => {
              resolve(tokenObject);
            })({ body: { username: input.email, password: input.password } });
          } catch (e) {
            logger.error(`[Configuration] Cant authenticate with ${auth.provider}`, e);
            resolve(null);
          }
        });
        // As soon as credential is validated, set the cookie and return.
        if (loginToken) {
          setAuthenticationCookie(loginToken, context.res);
          return loginToken.uuid;
        }
      }
      // User cannot be authenticated in any providers
      throw new AuthenticationFailure();
    },
    logout: (_, args, context) => logout(context.user, context.res),
    roleEdit: (_, { id }, { user }) => ({
      delete: () => stixDomainEntityDelete(id),
      fieldPatch: ({ input }) => stixDomainEntityEditField(user, id, input),
      contextPatch: ({ input }) => stixDomainEntityEditContext(user, id, input),
      contextClean: () => stixDomainEntityCleanContext(user, id),
      relationAdd: ({ input }) => stixDomainEntityAddRelation(user, id, input),
      removeCapability: ({ name }) => roleRemoveCapability(id, name)
    }),
    roleAdd: (_, { input }) => addRole(input),
    userEdit: (_, { id }, { user }) => ({
      delete: () => userDelete(id),
      fieldPatch: ({ input }) => userEditField(user, id, input),
      contextPatch: ({ input }) => stixDomainEntityEditContext(user, id, input),
      contextClean: () => stixDomainEntityCleanContext(user, id),
      tokenRenew: () => userRenewToken(id),
      removeRole: ({ name }) => removeRole(id, name),
      relationAdd: ({ input }) => stixDomainEntityAddRelation(user, id, input),
      relationDelete: ({ relationId }) => stixDomainEntityDeleteRelation(user, id, relationId)
    }),
    meEdit: (_, { input }, { user }) => meEditField(user, user.id, input),
    personAdd: (_, { input }, { user }) => addPerson(user, input),
    userAdd: (_, { input }, { user }) => addUser(user, input)
  }
};

export default userResolvers;
