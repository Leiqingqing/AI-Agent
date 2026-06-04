import { genSalt, hash256 } from "../lib/password"

export const hashPassword = async (password: string): Promise<string> => {
    const salt = genSalt()
    const passordHash = await hash256(password + salt)
    return `${salt}:${passordHash}`
}

export const verifyPassword = async (password: string, hash: string): Promise<boolean> => {
    const [salt, passordHash] = hash.split(':')
    const verifyHash = await hash256(password + salt)
    return verifyHash === passordHash
}
    