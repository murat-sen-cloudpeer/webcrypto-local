import { EventEmitter } from "events";
import { NotificationCenter } from "node-notifier";
import { Convert } from "pvtsutils";
import { ObjectProto } from "tsprotobuf";
import { Server, Session } from "../connection/server";
import { ActionProto, CryptoKeyPairProto, CryptoKeyProto, ResultProto, CryptoItemProto } from "../core/proto";
import { CertificateStorageClearActionProto, CertificateStorageExportActionProto, CertificateStorageGetItemActionProto, CertificateStorageImportActionProto, CertificateStorageKeysActionProto, CertificateStorageRemoveItemActionProto, CertificateStorageSetItemActionProto } from "../core/protos/certstorage";
import { ArrayStringConverter } from "../core/protos/converter";
import { IsLoggedInActionProto, LoginActionProto } from "../core/protos/crypto";
import { KeyStorageClearActionProto, KeyStorageGetItemActionProto, KeyStorageKeysActionProto, KeyStorageRemoveItemActionProto, KeyStorageSetItemActionProto } from "../core/protos/keystorage";
import { ProviderAuthorizedEventProto, ProviderCryptoProto, ProviderGetCryptoActionProto, ProviderInfoActionProto, ProviderTokenEventProto } from "../core/protos/provider";
import { DecryptActionProto, DeriveBitsActionProto, DeriveKeyActionProto, DigestActionProto, EncryptActionProto, ExportKeyActionProto, GenerateKeyActionProto, ImportKeyActionProto, SignActionProto, UnwrapKeyActionProto, VerifyActionProto, WrapKeyActionProto } from "../core/protos/subtle";
import { ServiceCryptoItem } from "./crypto_item";
import { LocalProvider } from "./provider";

const notifier = new (NotificationCenter as any)();
const crypto: Crypto = new (require("node-webcrypto-ossl"))();

export class LocalServer extends EventEmitter {

    public server: Server;
    public provider: LocalProvider;
    public cryptos: { [id: string]: Crypto } = {};
    public sessions: Session[] = [];

    protected memoryStorage: ServiceCryptoItem[] = [];

    constructor() {
        super();

        this.server = new Server();
        this.provider = new LocalProvider({
            pkcs11: [
                "/usr/local/lib/softhsm/libsofthsm2.so",
                "/usr/local/lib/libykcs11.dylib",
            ],
        });

        this.provider
            .on("token", (info) => {
                console.log("Provider:Token raised");
                this.sessions.forEach((session) => {
                    if (session.cipher && session.authorized) {
                        // info.added = info.added.map((item) => new ProviderCryptoProto(item)) || [];
                        // info.removed = info.removed.map((item) => new ProviderCryptoProto(item)) || [];
                        info.removed.forEach((item, index) => {
                            info.removed[index] = new ProviderCryptoProto(item);
                        });
                        info.added.forEach((item, index) => {
                            info.added[index] = new ProviderCryptoProto(item);
                        });
                        this.server.send(session, new ProviderTokenEventProto(info))
                            .catch((e) => {
                                console.error(e);
                            });
                    }
                });
            })
            .on("error", (e) => {
                this.emit("error", e);
            });
    }

    public listen(address: string) {
        this.server.listen(address);
        this.server
            .on("listening", () => {
                console.log("Server:listen");
                this.provider.open()
                    .catch((err) => {
                        console.log("Provider:OpenError");
                        this.emit("error", err);
                    });
            })
            .on("connect", (session) => {
                console.log("Server:Connect");
                // check connection in stack
                if (!(this.sessions.length && this.sessions.some((item) => item === session))) {
                    console.log("Push session");
                    this.sessions.push(session);
                }
            })
            .on("close", () => {
                // TODO: rename event to 'disconnect' and add event 'connect' for session
                console.log("Session:disconnect");

            })
            .on("error", (e) => {
                console.log("Server:error");
                this.emit("error", e.error);
            })
            .on("message", (e) => {
                console.log("Session:Message");
                this.onMessage(e.session, e.message)
                    .then(e.resolve, e.reject);
            })
            .on("auth", (session) => {
                console.log("Session:auth");
                this.server.send(session, new ProviderAuthorizedEventProto())
                    .catch((e) => {
                        console.error(e);
                    });
            });
        return this;
    }

    protected async  onMessage(session: Session, action: ActionProto) {
        const resultProto = new ResultProto(action);

        let data: ArrayBuffer | undefined;
        switch (action.action) {
            // Provider
            case ProviderInfoActionProto.ACTION: {
                const info = this.provider.info;

                data = await info.exportProto();
                break;
            }
            case ProviderGetCryptoActionProto.ACTION: {
                const getCryptoParams = await ProviderGetCryptoActionProto.importProto(action);

                await this.provider.getCrypto(getCryptoParams.cryptoID);

                break;
            }
            // crypto
            case IsLoggedInActionProto.ACTION: {
                const params = await IsLoggedInActionProto.importProto(action);

                const crypto = await this.provider.getCrypto(params.providerID);

                data = new Uint8Array([crypto.isLoggedIn ? 1 : 0]).buffer;
                break;
            }
            case LoginActionProto.ACTION: {
                const params = await LoginActionProto.importProto(action);

                const crypto = await this.provider.getCrypto(params.providerID);

                if (crypto.login) {
                    // show prompt
                    await new Promise((resolve, reject) => {
                        notifier.notify({
                            title: "webcrypto-local",
                            message: `Enter PIN for PKCS#11 token`,
                            wait: true,
                            // actions: "Yes",
                            // closeLabel: "No",
                            timeout: -1,
                            reply: true,
                            // timeout: 30,
                        } as any, (error: Error, response: string, metadata: { activationValue: string }) => {
                            try {
                                if (response !== "replied") {
                                    reject(new Error("CryptoLogin timeout"));
                                } else {
                                    console.log(crypto);
                                    console.log(metadata.activationValue, metadata.activationValue.length);
                                    // throw new Error("Oops");
                                    crypto.login(metadata.activationValue);
                                    resolve();
                                }
                            } catch (err) {
                                reject(err);
                            }
                        });
                    });
                }
                break;
            }
            // crypto/subtle
            case DigestActionProto.ACTION: {
                const params = await DigestActionProto.importProto(action);

                const crypto = await this.provider.getCrypto(params.providerID);

                data = await crypto.subtle.digest(params.algorithm, params.data);
                break;
            }
            case GenerateKeyActionProto.ACTION: {
                const params = await GenerateKeyActionProto.importProto(action);

                const crypto = await this.provider.getCrypto(params.providerID);
                const keys = await crypto.subtle.generateKey(params.algorithm, params.extractable, params.usage);

                // add key to memory storage
                let keyProto: ObjectProto;
                if ((keys as CryptoKeyPair).privateKey) {
                    const keyPair = keys as CryptoKeyPair;
                    // CryptoKeyPair
                    console.log("CryptoKeyPair");
                    const thumbprint = await GetIdentity(keyPair.publicKey, crypto);
                    console.log("Identity");
                    const publicKey = new ServiceCryptoItem(thumbprint, keyPair.publicKey, params.providerID);
                    const privateKey = new ServiceCryptoItem(thumbprint, keyPair.privateKey, params.providerID);
                    this.memoryStorage.push(publicKey);
                    this.memoryStorage.push(privateKey);

                    // convert `keys` to CryptoKeyPairProto
                    const keyPairProto = new CryptoKeyPairProto();
                    keyPairProto.privateKey = privateKey.toProto() as CryptoKeyProto;
                    keyPairProto.publicKey = publicKey.toProto() as CryptoKeyProto;
                    keyProto = keyPairProto;
                } else {
                    // CryptoKey
                    const key: CryptoKey = keys as any;
                    const thumbprint = await GetIdentity(key, crypto);
                    const secretKey = new ServiceCryptoItem(thumbprint, key, params.providerID);
                    this.memoryStorage.push(secretKey);

                    keyProto = secretKey.toProto();
                }

                data = await keyProto.exportProto();
                break;
            }
            case SignActionProto.ACTION: {
                const params = await SignActionProto.importProto(action);

                const crypto = await this.provider.getCrypto(params.providerID);

                const key = this.getItemFromStorage(params.key).item as CryptoKey;
                data = await crypto.subtle.sign(params.algorithm.toAlgorithm(), key, params.data);
                break;
            }
            case VerifyActionProto.ACTION: {
                const params = await VerifyActionProto.importProto(action);

                const crypto = await this.provider.getCrypto(params.providerID);

                const key = this.getItemFromStorage(params.key).item as CryptoKey;
                const ok = await crypto.subtle.verify(params.algorithm.toAlgorithm(), key, params.signature, params.data);

                data = new Uint8Array([ok ? 1 : 0]).buffer;
                break;
            }
            case EncryptActionProto.ACTION: {
                const params = await EncryptActionProto.importProto(action);

                const crypto = await this.provider.getCrypto(params.providerID);
                const key = this.getItemFromStorage(params.key).item as CryptoKey;

                data = await crypto.subtle.encrypt(params.algorithm.toAlgorithm(), key, params.data);
                break;
            }
            case DecryptActionProto.ACTION: {
                const params = await DecryptActionProto.importProto(action);

                const crypto = await this.provider.getCrypto(params.providerID);
                const key = this.getItemFromStorage(params.key).item as CryptoKey;

                data = await crypto.subtle.decrypt(params.algorithm.toAlgorithm(), key, params.data);
                break;
            }
            case DeriveBitsActionProto.ACTION: {
                const params = await DeriveBitsActionProto.importProto(action);

                const crypto = await this.provider.getCrypto(params.providerID);
                const key = this.getItemFromStorage(params.key).item as CryptoKey;
                const alg = params.algorithm.toAlgorithm();
                const publicKey = await CryptoKeyProto.importProto(alg.public);
                alg.public = this.getItemFromStorage(publicKey).item as CryptoKey;

                data = await crypto.subtle.deriveBits(alg, key, params.length);
                break;
            }
            case DeriveKeyActionProto.ACTION: {
                const params = await DeriveKeyActionProto.importProto(action);

                const crypto = await this.provider.getCrypto(params.providerID);
                const key = this.getItemFromStorage(params.key).item as CryptoKey;
                const alg = params.algorithm.toAlgorithm();
                const publicKey = await CryptoKeyProto.importProto(alg.public);
                alg.public = this.getItemFromStorage(publicKey).item as CryptoKey;

                const derivedKey = await crypto.subtle.deriveKey(alg, key, params.derivedKeyType, params.extractable, params.usage);

                // put key to memory storage
                const thumbprint = await GetIdentity(derivedKey, crypto);
                const resKey = new ServiceCryptoItem(thumbprint, derivedKey, params.providerID);
                this.memoryStorage.push(resKey);

                data = await resKey.toProto().exportProto();
                break;
            }
            case WrapKeyActionProto.ACTION: {
                const params = await WrapKeyActionProto.importProto(action);

                const crypto = await this.provider.getCrypto(params.providerID);
                const key = await this.getItemFromStorage(params.key).item as CryptoKey;
                const wrappingKey = this.getItemFromStorage(params.wrappingKey).item as CryptoKey;

                data = await crypto.subtle.wrapKey(
                    params.format,
                    key,
                    wrappingKey,
                    params.wrapAlgorithm.toAlgorithm()
                );
                break;
            }
            case UnwrapKeyActionProto.ACTION: {
                const params = await UnwrapKeyActionProto.importProto(action);

                const crypto = await this.provider.getCrypto(params.providerID);
                const unwrappingKey = await this.getItemFromStorage(params.unwrappingKey).item as CryptoKey;

                const key = await crypto.subtle.unwrapKey(
                    params.format,
                    params.wrappedKey,
                    unwrappingKey,
                    params.unwrapAlgorithm.toAlgorithm(),
                    params.unwrappedKeyAlgorithm.toAlgorithm(),
                    params.extractable,
                    params.keyUsage,
                );

                // put key to memory storage
                const thumbprint = await GetIdentity(key, crypto);
                const resKey = new ServiceCryptoItem(thumbprint, key, params.providerID);
                this.memoryStorage.push(resKey);

                data = await resKey.toProto().exportProto();
                break;
            }
            case ExportKeyActionProto.ACTION: {
                const params = await ExportKeyActionProto.importProto(action);

                const crypto = await this.provider.getCrypto(params.providerID);
                const key = await this.getItemFromStorage(params.key).item as CryptoKey;

                const exportedData = await crypto.subtle.exportKey(
                    params.format,
                    key,
                );

                if (params.format.toLowerCase() === "jwk") {
                    const json = JSON.stringify(exportedData);
                    data = Convert.FromUtf8String(json);
                } else {
                    data = exportedData as ArrayBuffer;
                }

                break;
            }
            case ImportKeyActionProto.ACTION: {
                const params = await ImportKeyActionProto.importProto(action);

                const crypto = await this.provider.getCrypto(params.providerID);

                let keyData: JsonWebKey | ArrayBuffer;
                if (params.format.toLowerCase() === "jwk") {
                    const json = Convert.ToUtf8String(params.keyData);
                    keyData = JSON.parse(json);
                } else {
                    keyData = params.keyData;
                }

                const key = await crypto.subtle.importKey(
                    params.format,
                    keyData,
                    params.algorithm.toAlgorithm(),
                    params.extractable,
                    params.keyUsages,
                );

                // put key to memory storage
                const thumbprint = await GetIdentity(key, crypto);
                const resKey = new ServiceCryptoItem(thumbprint, key, params.providerID);
                this.memoryStorage.push(resKey);

                data = await resKey.toProto().exportProto();
                break;
            }
            // Key storage
            case KeyStorageGetItemActionProto.ACTION: {
                // prepare incoming data
                const params = await KeyStorageGetItemActionProto.importProto(action);
                const crypto = await this.provider.getCrypto(params.providerID);

                // do operation
                const key = await crypto.keyStorage.getItem(
                    params.key,
                    params.algorithm.isEmpty() ? null : params.algorithm,
                    params.keyUsages ? null : params.keyUsages,
                );

                // add keys to memory storage
                if (!key) {
                    throw new Error(`Cannot get key by identity '${params.key}'`);
                }
                const thumbprint = await GetIdentity(key, crypto);
                const cryptoKey = new ServiceCryptoItem(thumbprint, key, params.providerID);
                this.memoryStorage.push(cryptoKey);

                data = await cryptoKey.toProto().exportProto();
                break;
            }
            case KeyStorageSetItemActionProto.ACTION: {
                // prepare incoming data
                const params = await KeyStorageSetItemActionProto.importProto(action);
                const key = this.getItemFromStorage(params.item).item as CryptoKey;
                const crypto = await this.provider.getCrypto(params.providerID);
                // do operation
                const index = await crypto.keyStorage.setItem(key);
                data = Convert.FromUtf8String(index);
                // result
                break;
            }
            case KeyStorageRemoveItemActionProto.ACTION: {
                // prepare incoming data
                const params = await KeyStorageRemoveItemActionProto.importProto(action);
                const crypto = await this.provider.getCrypto(params.providerID);
                // do operation
                await crypto.keyStorage.removeItem(params.key);
                // result
                break;
            }
            case KeyStorageKeysActionProto.ACTION: {
                // load key storage
                const params = await KeyStorageKeysActionProto.importProto(action);
                const crypto = await this.provider.getCrypto(params.providerID);
                // do operation
                const keys = await crypto.keyStorage.keys();
                // result
                data = (await ArrayStringConverter.set(keys)).buffer;
                break;
            }
            case KeyStorageClearActionProto.ACTION: {
                // load cert storage
                const params = await KeyStorageClearActionProto.importProto(action);
                const crypto = await this.provider.getCrypto(params.providerID);

                // do operation
                await crypto.certStorage.clear();
                // result
                break;
            }
            // Certificate storage
            case CertificateStorageGetItemActionProto.ACTION: {
                // prepare incoming data
                const params = await CertificateStorageGetItemActionProto.importProto(action);
                const crypto = await this.provider.getCrypto(params.providerID);
                // do operation
                const item = await crypto.certStorage.getItem(
                    params.key,
                    params.algorithm.isEmpty() ? null : params.algorithm,
                    params.keyUsages ? null : params.keyUsages,
                );

                // add key to memory storage
                const thumbprint = await GetIdentity(item.publicKey, crypto);
                const cryptoKey = new ServiceCryptoItem(thumbprint, item.publicKey, params.providerID);
                this.memoryStorage.push(cryptoKey);
                // add cert to memory storage
                const cryptoCert = new ServiceCryptoItem(thumbprint, item, params.providerID);
                this.memoryStorage.push(cryptoCert);

                // create Cert proto
                resultProto.data = await cryptoCert.toProto().exportProto();
                return resultProto;
            }
            case CertificateStorageSetItemActionProto.ACTION: {
                // prepare incoming data
                const params = await CertificateStorageSetItemActionProto.importProto(action);
                const crypto = await this.provider.getCrypto(params.providerID);
                const cert = this.getItemFromStorage(params.item).item as CryptoCertificate;
                // do operation
                const index = await crypto.certStorage.setItem(cert);
                data = Convert.FromUtf8String(index);
                // result
                break;
            }
            case CertificateStorageRemoveItemActionProto.ACTION: {
                // prepare incoming data
                const params = await CertificateStorageRemoveItemActionProto.importProto(action);
                const crypto = await this.provider.getCrypto(params.providerID);
                // do operation
                await crypto.certStorage.removeItem(params.key);
                // result
                break;
            }
            case CertificateStorageImportActionProto.ACTION: {
                // prepare incoming data
                const params = await CertificateStorageImportActionProto.importProto(action);
                const crypto = await this.provider.getCrypto(params.providerID);
                // do operation
                const item = await crypto.certStorage.importCert(params.type, params.data, params.algorithm, params.keyUsages);
                // add key to memory storage
                const thumbprint = await GetIdentity(item.publicKey, crypto);
                const cryptoKey = new ServiceCryptoItem(thumbprint, item.publicKey, params.providerID);
                this.memoryStorage.push(cryptoKey);
                // add cert to memory storage
                const cryptoCert = new ServiceCryptoItem(thumbprint, item, params.providerID);
                this.memoryStorage.push(cryptoCert);
                // result
                data = await cryptoCert.toProto().exportProto();
                break;
            }
            case CertificateStorageExportActionProto.ACTION: {
                // prepare incoming data
                const params = await CertificateStorageExportActionProto.importProto(action);
                const crypto = await this.provider.getCrypto(params.providerID);
                const cert = this.getItemFromStorage(params.item).item as CryptoCertificate;
                // do operation
                // TODO: get item by id
                const exportedData = await crypto.certStorage.exportCert(params.format, cert);

                // result
                if (exportedData instanceof ArrayBuffer) {
                    data = exportedData;
                } else {
                    data = Convert.FromUtf8String(exportedData);
                }
                break;
            }
            case CertificateStorageKeysActionProto.ACTION: {
                // load cert storage
                const params = await CertificateStorageKeysActionProto.importProto(action);
                const crypto = await this.provider.getCrypto(params.providerID);

                // do operation
                const keys = await crypto.certStorage.keys();
                // result
                data = (await ArrayStringConverter.set(keys)).buffer;
                break;
            }
            case CertificateStorageClearActionProto.ACTION: {
                // load cert storage
                const params = await CertificateStorageKeysActionProto.importProto(action);
                const crypto = await this.provider.getCrypto(params.providerID);

                // do operation
                await crypto.certStorage.clear();
                // result
                break;
            }
            default:
                throw new Error(`Unknown action '${action.action}'`);
        }
        resultProto.data = data;
        return resultProto;
    }

    protected getItemFromStorage(cryptoItem: CryptoItemProto) {
        let foundKey: ServiceCryptoItem;
        this.memoryStorage.some((item) => {
            if (item.id === cryptoItem.id &&
                item.providerID === cryptoItem.providerID &&
                item.item.type === cryptoItem.type
            ) {
                foundKey = item;
            }
            return !!foundKey;
        });
        if (!foundKey) {
            if (!crypto) {
                throw new Error(`Cannot get CryptoItem by ID '${cryptoItem.id}'`);
            }
        }
        return foundKey;
    }

}

async function GetIdentity(key: CryptoKey, provider: Crypto) {
    if (key.type !== "public") {
        const rndBytes = crypto.getRandomValues(new Uint8Array(32)) as Uint8Array;
        return Convert.ToHex(rndBytes);
    } else {
        const jwk = await provider.subtle.exportKey("jwk", key); // INFO: Not all crypto implementations support spki
        const osslKey = await crypto.subtle.importKey("jwk", jwk, key.algorithm as any, true, key.usages);
        const raw = await crypto.subtle.exportKey("spki", osslKey);
        const thumbprint = await crypto.subtle.digest("SHA-256", raw);
        return Convert.ToHex(thumbprint);
    }
}