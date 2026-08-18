import { customAlphabet } from "nanoid";

const pairingAlphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // no 0/O/1/I ambiguity
export const generatePairingCode = customAlphabet(pairingAlphabet, 8);

const apiKeyAlphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
export const generateApiKey = customAlphabet(apiKeyAlphabet, 40);
