import hre from "hardhat"
import { buildModule } from "@nomicfoundation/hardhat-ignition/modules"
import { ZeroAddress } from "ethers";
import { loadQpDeployConfig, QpDeployConfig } from "../../scripts/utils/DeployUtils";
const DEFAULT_QP_CONFIG_FILE = 'QpDeployConfig.yaml';


const deployModule = buildModule("DeployModule", (m) => {
    
    const currentChainId = 26100
    const conf: QpDeployConfig = loadQpDeployConfig(process.env.QP_CONFIG_FILE || DEFAULT_QP_CONFIG_FILE);
    const owner = m.getAccount(0)
    const signer1 = m.getAccount(1)
    const signer2 = m.getAccount(2)
    const signer3 = m.getAccount(3)
    const signer4 = m.getAccount(4)
    const signer5 = m.getAccount(5)
    const signer6 = m.getAccount(6)
    const signer7 = m.getAccount(7)

    //--------------- Gateway ----------------//
    const gatewayImpl = m.contract("QuantumPortalGatewayUpgradeable", ["0x0000000000000000000000000000000000000000"], { id: "QPGatewayImpl"})

    const timelockPeriod = 60 * 60 * 24 * 1 // 1 day
    const quorums = [
        {
            minSignatures: 2,
            addresses: [
                owner,
                signer1,
            ]
        },
        {
            minSignatures: 2,
            addresses: [
                signer2,
                signer3,
                signer4,
            ]
        },
        {
            minSignatures: 2,
            addresses: [
                signer5,
                signer6,
                signer7
            ]
        },
    ];

    let initializeCalldata: any = m.encodeFunctionCall(gatewayImpl, "initialize", [
        timelockPeriod,
        quorums,

		owner,
		owner
	]);
    const gatewayProxy = m.contract("ERC1967Proxy", [gatewayImpl, initializeCalldata], { id: "GatewayProxy"})
    const gateway = m.contractAt("QuantumPortalGatewayUpgradeable", gatewayProxy, { id: "Gateway"})

    //--------------- LedgerManager -----------//
    const ledgerMgrImpl = m.contract("QuantumPortalLedgerMgrImplUpgradeable", [], { id: "LedgerMgrImpl"})
    initializeCalldata = m.encodeFunctionCall(ledgerMgrImpl, "initialize", [
        owner,
        owner,
        conf.QuantumPortalMinStake!,
        gateway
    ]);
    const ledgerMgrProxy = m.contract("ERC1967Proxy", [ledgerMgrImpl, initializeCalldata], { id: "LedgerMgrProxy"})
    const ledgerMgr = m.contractAt("QuantumPortalLedgerMgrImplUpgradeable", ledgerMgrProxy, { id: "LedgerMgr"})

    //--------------- Poc ---------------------//
    const pocImpl = m.contract("QuantumPortalPocImplUpgradeable", [], { id: "PocImpl"})
    initializeCalldata = m.encodeFunctionCall(pocImpl, "initialize", [
        owner,
        owner,
        gateway
    ]);
    const pocProxy = m.contract("ERC1967Proxy", [pocImpl, initializeCalldata], { id: "PocProxy"})
    const poc = m.contractAt("QuantumPortalPocImplUpgradeable", pocProxy, { id: "Poc"})

    //--------------- AuthorityManager --------//
    const authMgrImpl = m.contract("QuantumPortalAuthorityMgrUpgradeable", [], { id: "AuthMgrImpl"})
    initializeCalldata = m.encodeFunctionCall(authMgrImpl, "initialize", [
        ledgerMgr,
        poc,
        owner,
        owner,
        gateway
    ]);
    const authMgrProxy = m.contract("ERC1967Proxy", [authMgrImpl, initializeCalldata], { id: "AuthMgrProxy"})
    const authMgr = m.contractAt("QuantumPortalAuthorityMgrUpgradeable", authMgrProxy, { id: "AuthMgr"})

    // //--------------- Oracle ------------------//
    // // const oracle = m.contract("UniswapOracle", [conf.UniV2Factory[currentChainId!]], { id: "Oracle"})

    //--------------- FeeConverterDirect ------------//
    const feeConverterDirectImpl = m.contract("QuantumPortalFeeConverterDirectUpgradeable", [], { id: "FeeConverterDirectImpl"})
    initializeCalldata = m.encodeFunctionCall(feeConverterDirectImpl, "initialize", [
        gateway,
        owner
    ]);
    const feeConverterDirectProxy = m.contract("ERC1967Proxy", [feeConverterDirectImpl, initializeCalldata], { id: "FeeConverterDirectProxy"})
    const feeConverterDirect = m.contractAt("QuantumPortalFeeConverterDirectUpgradeable", feeConverterDirectProxy, { id: "FeeConverterDirect"})

    //--------------- StakeWithDelegate -------//
    const stakingImpl = m.contract("QuantumPortalStakeWithDelegateUpgradeable", [], { id: "StakingImpl"})
    initializeCalldata = m.encodeFunctionCall(stakingImpl, "initialize(address,address,address,address,address)", [
        conf.FRM[currentChainId!],
        authMgr,
        ZeroAddress,
        gateway,
        owner
    ]);
    const stakingProxy = m.contract("ERC1967Proxy", [stakingImpl, initializeCalldata], { id: "StakingProxy"})
    const staking = m.contractAt("QuantumPortalStakeWithDelegateUpgradeable", stakingProxy, { id: "Staking"})

    //---------------- MiningManager ----------//
    const minerMgrImpl = m.contract("QuantumPortalMinerMgrUpgradeable", [], { id: "MinerMgrImpl"})
    initializeCalldata = m.encodeFunctionCall(minerMgrImpl, "initialize", [
        staking,
        poc,
        ledgerMgr,
        gateway,
        owner
    ]);
    const minerMgrProxy = m.contract("ERC1967Proxy", [minerMgrImpl, initializeCalldata], { id: "MinerMgrProxy"})
    const minerMgr = m.contractAt("QuantumPortalMinerMgrUpgradeable", minerMgrProxy, { id: "MinerMgr"})

    //----------------- Setup -----------------//
    m.call(ledgerMgr, "updateAuthorityMgr", [authMgr])
	m.call(ledgerMgr, "updateMinerMgr", [minerMgr])
	m.call(ledgerMgr, "updateFeeConvertor", [feeConverterDirect])

    m.call(poc, "setManager", [ledgerMgr])
	m.call(poc, "setFeeToken", [conf.FRM[currentChainId!]])
    
	m.call(minerMgr, "updateBaseToken", [conf.FRM[currentChainId!]])
	m.call(ledgerMgr, "updateLedger", [poc], { id: "UpdateLedgerOnLedgerMgr"})

    // SET FEEPERBYTE ON FEECONVERTERDIRECT

    return {
        gateway,
        ledgerMgr,
        poc,
        authMgr,
        feeConverterDirect,
        staking,
        minerMgr
    }
})

const configModule = buildModule("ConfigModule", (m) => {
    const { gateway,
        ledgerMgr,
        poc,
        authMgr,
        feeConverterDirect,
        staking,
        minerMgr
    } = m.useModule(deployModule)

    m.call(poc, "updateFeeTarget")
    m.call(gateway, "upgrade", [poc, ledgerMgr, staking])

    return {
        gateway,
        ledgerMgr,
        poc,
        authMgr,
        feeConverterDirect,
        staking,
        minerMgr
    }
})

export default configModule;
