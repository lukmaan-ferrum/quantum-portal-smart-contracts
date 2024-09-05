// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MultiSigCheckableUpgradeable} from "foundry-contracts/contracts/contracts-upgradeable/signature/MultiSigCheckableUpgradeable.sol";


/**
 * @title FerrumAdmin
 * @notice Intended to be inherited by Quantum Portal Gateway contract
 */
abstract contract FerrumAdminUpgradeable is MultiSigCheckableUpgradeable {
    // HARDCODE THESE TO VALUES SUCH THAT TIMELOCKED_PROD > PROD > BETA
    address public constant BETA_QUORUMID = address(123);
    address public constant PROD_QUORUMID = address(456);
    address public constant TIMELOCKED_PROD_QUORUMID = address(789);
    bytes32 constant PERMIT_CALL_TYPEHASH = keccak256("PermitCall(address target,bytes data,address quorumId,bytes32 salt,uint256 expiry)");

    /// @custom:storage-location erc7201:ferrum.storage.ferrumadmin.001
    struct FerrumAdminStorageV001 {
        bool authInitialized;
        uint256 timelockPeriod;
        mapping(address => bool) devAccounts;
        mapping(bytes32 => FerrumAdminUpgradeable.PermittedCall) permittedCalls;
        mapping(bytes32 => address) minRequiredAuth;
    }

    // keccak256(abi.encode(uint256(keccak256("ferrum.storage.ferrumadmin.001")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant FerrumAdminStorageV001Location = 0x090b67f069e2ef623d1b1ff39d73da6c91ee47bd12c4a1d2d8651f5faf006200;

    struct MinAuthSetting {
        address quorumId;
        address target;
        bytes4 funcSelector;
    }

    struct PermittedCall {
        bool isPermitted;
        uint120 executableFrom;
        uint120 expiry;
    }

    struct InitQuorum {
        uint16 minSignatures;
        address[] addresses;
    }

    event DevAccountAdded(address indexed account);
    event DevAccountRemoved(address indexed account);
    event CallPermitted(bytes32 indexed callHash, address indexed target, bytes data);
    event CallExecuted(bytes32 indexed callHash, address indexed target, bytes data);

    modifier onlyDevs() {
        require(_getFerrumAdminStorageV001().devAccounts[msg.sender], "Only devs can execute");
        _;
    }

    modifier onlyDevsOrAdmin() {
        require(_getFerrumAdminStorageV001().devAccounts[msg.sender] || msg.sender == owner(), "Only devs or admin can add/remove dev accounts");
        _;
    }

    /**
     * @dev Always pass in the Quorums array in this order:
     * index 0: BETA_QUORUMID
     * index 1: PROD_QUORUMID
     * index 2: TIMELOCKED_PROD_QUORUMID
     * @param quorums Array of quorums to initialize
     */
    function __FerrumAdmin_init(uint256 _timelockPeriod,
        InitQuorum[] memory quorums,
        address initialOwner,
        address initialAdmin,
        string memory name,
        string memory version
    ) internal {
        __FerrumAdmin_init_unchained(_timelockPeriod, quorums);
        __WithAdmin_init(initialOwner, initialAdmin);
        __EIP712_init(name, version);
    }

    function __FerrumAdmin_init_unchained(
        uint256 _timelockPeriod,
        InitQuorum[] memory quorums
    ) internal {
        _initializeQuorum(BETA_QUORUMID, 0, quorums[0].minSignatures, 0, quorums[0].addresses);
        _initializeQuorum(PROD_QUORUMID, 0, quorums[1].minSignatures, 0, quorums[1].addresses);
        _initializeQuorum(TIMELOCKED_PROD_QUORUMID, 0, quorums[2].minSignatures, 0, quorums[2].addresses);

        FerrumAdminStorageV001 storage $ = _getFerrumAdminStorageV001();
        $.timelockPeriod = _timelockPeriod;
    }

    function permitCall(
        address target,
        bytes calldata data,
        address quorumId,
        bytes32 salt,
        uint64 expiry,
        bytes memory multiSignature
    ) external {
        FerrumAdminStorageV001 storage $ = _getFerrumAdminStorageV001();
        bytes32 structHash = keccak256(
            abi.encode(
                PERMIT_CALL_TYPEHASH,
                target,
                keccak256(data),
                quorumId,
                salt,
                expiry
            )
        );

        // Verify
        require(expiry < block.timestamp + 7 days, "Expiry too far");
        _validateAuthLevel(target, data, quorumId);
        verifyUniqueSaltWithQuorumId(structHash, quorumId, salt, 0, multiSignature);

        // Store the permitted call
        uint120 excecutableFrom = quorumId == TIMELOCKED_PROD_QUORUMID ?
            uint120(block.timestamp + $.timelockPeriod) :
            uint120(block.timestamp);
        
        $.permittedCalls[structHash] = PermittedCall(true, excecutableFrom, expiry);

        emit CallPermitted(structHash, target, data);
    }

    function executePermittedCall(
        address target,
        bytes calldata data,
        address quorumId,
        bytes32 salt,
        uint64 expiry
    ) external onlyDevs {
        FerrumAdminStorageV001 storage $ = _getFerrumAdminStorageV001();
        // Hash the call details
        bytes32 structHash = keccak256(
            abi.encode(
                PERMIT_CALL_TYPEHASH,
                target,
                keccak256(data),
                quorumId,
                salt,
                expiry
            )
        );

        // Ensure the call is permitted
        require($.permittedCalls[structHash].isPermitted, "FA: not permitted");
        require(block.timestamp < $.permittedCalls[structHash].expiry, "FA: expired");
        require(block.timestamp >= $.permittedCalls[structHash].executableFrom, "FA: not executable yet");

        // Execute the call
        (bool success, ) = target.call(data);
        require(success, "FA: fail");

        // Clear the permitted call
        delete $.permittedCalls[structHash];

        emit CallExecuted(structHash, target, data);
    }

    function addDevAccounts(address[] memory account) external onlyDevsOrAdmin {
        FerrumAdminStorageV001 storage $ = _getFerrumAdminStorageV001();
        for (uint i = 0; i < account.length; i++) {
            if($.devAccounts[account[i]]) continue; // Prevents redundant event emission
            $.devAccounts[account[i]] = true;
            emit DevAccountAdded(account[i]);
        }
    }

    function removeDevAccounts(address[] memory account) external onlyDevsOrAdmin {
        FerrumAdminStorageV001 storage $ = _getFerrumAdminStorageV001();
        for (uint i = 0; i < account.length; i++) {
            if(!$.devAccounts[account[i]]) continue; // As above
            emit DevAccountRemoved(account[i]);
        }
    }

    function setCallAuthLevels(
        MinAuthSetting[] memory settings
    ) external onlyDevs {
        FerrumAdminStorageV001 storage $ = _getFerrumAdminStorageV001();
        require(!$.authInitialized, "FA: already set");
        $.authInitialized = true;
        _setCallAuthLevels(settings);
    }

    function setCallAuthLevels(
        MinAuthSetting[] memory settings,
        bytes32 salt,
        bytes memory multiSignature
    ) external {
        bytes32 callHash = keccak256(abi.encode(settings, salt));
        verifyUniqueSaltWithQuorumId(callHash, TIMELOCKED_PROD_QUORUMID, salt, 0, multiSignature);
        _setCallAuthLevels(settings);
    }

    function updateTimelockPeriod(
        uint256 newPeriod,
        bytes32 salt,
        bytes memory multiSignature
    ) external {
        FerrumAdminStorageV001 storage $ = _getFerrumAdminStorageV001();

        bytes32 callHash = keccak256(abi.encode(newPeriod, salt));
        verifyUniqueSaltWithQuorumId(callHash, TIMELOCKED_PROD_QUORUMID, salt, 0, multiSignature);

        $.timelockPeriod = newPeriod;
    }

    function timelockPeriod() external view returns (uint256) {
        return _getFerrumAdminStorageV001().timelockPeriod;
    }

    function devAccounts(address account) external view returns (bool) {
        return _getFerrumAdminStorageV001().devAccounts[account];
    }

    function permittedCalls(bytes32 structHash) external view returns (PermittedCall memory) {
        return _getFerrumAdminStorageV001().permittedCalls[structHash];
    }

    function minRequiredAuth(address target, bytes4 funcSelector) external view returns (address) {
        FerrumAdminStorageV001 storage $ = _getFerrumAdminStorageV001();
        bytes32 key = _getKey(target, funcSelector);
        return $.minRequiredAuth[key];
    }

    function _setCallAuthLevels(MinAuthSetting[] memory settings) internal {
        FerrumAdminStorageV001 storage $ = _getFerrumAdminStorageV001();
        for (uint i = 0; i < settings.length; i++) {
            bytes32 key = _getKey(settings[i].target, settings[i].funcSelector);
            $.minRequiredAuth[key] = settings[i].quorumId;
        }
    }

    function _getKey(address qpContract, bytes4 funcSelector) private pure returns (bytes32) {
        bytes32 key; // Takes the shape of 0x{4byteFuncSelector}00..00{20byteQPContractAddress}
        assembly {
            key := or(
                and(funcSelector, 0xffffffff00000000000000000000000000000000000000000000000000000000), // Remove this mask?
                qpContract
            )
        }
        return key;
    }

    function _validateAuthLevel(address target, bytes calldata data, address quorumId) private view {
        FerrumAdminStorageV001 storage $ = _getFerrumAdminStorageV001();
        bytes32 key = _getKey(target, bytes4(data));
        require(uint160(quorumId) >= uint160($.minRequiredAuth[key]), "FA: auth");
    }

    function _getFerrumAdminStorageV001() private pure returns (FerrumAdminStorageV001 storage $) {
        assembly {
            $.slot := FerrumAdminStorageV001Location
        }
    }
}
